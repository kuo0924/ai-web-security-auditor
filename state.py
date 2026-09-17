"""執行期狀態：限流器、每日額度、使用量統計、徽章快取，以及 Upstash 持久化。"""
from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict, deque
from datetime import UTC, datetime
from typing import Any

import httpx

from config import *  # noqa: F401,F403


# ---------------------------------------------------------------------------
# 2. 記憶體限流（滑動視窗）
# ---------------------------------------------------------------------------
class SlidingWindowLimiter:
    def __init__(self, max_hits: int, window_seconds: int) -> None:
        self.max_hits = max_hits
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> tuple[bool, int]:
        """回傳 (是否允許, 建議等待秒數)。"""
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] >= self.window:
            q.popleft()
        if len(q) >= self.max_hits:
            return False, int(self.window - (now - q[0])) + 1
        q.append(now)
        if len(self._hits) > 5000:  # 避免記憶體無限成長
            for k in [k for k, v in self._hits.items() if not v]:
                del self._hits[k]
        return True, 0


scan_limiter = SlidingWindowLimiter(*SCAN_RATE_LIMIT)
consult_limiter = SlidingWindowLimiter(*CONSULT_RATE_LIMIT)
consult_hourly_limiter = SlidingWindowLimiter(CONSULT_HOURLY_LIMIT, 3600)
feedback_limiter = SlidingWindowLimiter(*FEEDBACK_RATE_LIMIT)


class DailyBudget:
    """全站每日 LLM 用量（UTC 日界）：呼叫次數 + Claude 估算金額，保護金鑰額度不被公開流量燒光。"""

    def __init__(self, limit: int, usd_limit: float) -> None:
        self.limit = limit
        self.usd_limit = usd_limit
        self.day: Any = None
        self.used = 0
        self.usd = 0.0

    def _roll(self) -> None:
        today = datetime.now(UTC).date()
        if self.day != today:
            self.day, self.used, self.usd = today, 0, 0.0

    def take(self) -> bool:
        """一次 LLM 呼叫（不分供應商）。"""
        self._roll()
        if self.limit > 0 and self.used >= self.limit:
            return False
        self.used += 1
        return True

    def usd_available(self) -> bool:
        self._roll()
        return self.usd_limit <= 0 or self.usd < self.usd_limit

    def record_usd(self, amount: float) -> None:
        self._roll()
        self.usd += amount

    def status(self) -> dict[str, Any]:
        self._roll()
        return {
            "used_today": self.used, "daily_limit": self.limit,
            "claude_usd_today": round(self.usd, 4), "claude_usd_limit": self.usd_limit,
        }

    def export(self) -> dict[str, Any]:
        self._roll()
        return {"day": self.day.isoformat() if self.day else None, "used": self.used, "usd": self.usd}

    def load(self, data: dict[str, Any]) -> None:
        try:
            day = datetime.fromisoformat(data["day"]).date() if data.get("day") else None
            if day == datetime.now(UTC).date():
                self.day, self.used, self.usd = day, int(data.get("used", 0)), float(data.get("usd", 0.0))
        except (KeyError, ValueError, TypeError):
            pass


llm_budget = DailyBudget(LLM_DAILY_BUDGET, LLM_DAILY_BUDGET_USD)
badge_cache: dict[str, dict[str, Any]] = {}  # host -> {"score", "grade", "at"}，只記經授權掃描的結果

class UsageStats:
    """使用量統計（記憶體，服務重啟歸零）：只存彙總數字，不存目標網址。"""

    KEEP_DAYS = 7

    def __init__(self) -> None:
        self.started_at = datetime.now(UTC)
        self.days: dict[str, dict[str, Any]] = {}
        self.total = self._blank()
        self.feedback: dict[str, dict[str, int]] = {}  # "kind:id" -> {"up", "down"}，全期累計，不分日

    @staticmethod
    def _blank() -> dict[str, Any]:
        return {
            "scans": 0, "scans_rejected": 0, "scans_rate_limited": 0, "scans_failed": 0,
            "consults": 0, "consults_llm": 0, "consults_fallback": 0, "followups": 0,
            "grades": {"A": 0, "B": 0, "C": 0, "F": 0}, "platforms": {}, "scan_ms_sum": 0, "ips": set(),
        }

    def _today(self) -> dict[str, Any]:
        key = datetime.now(UTC).date().isoformat()
        if key not in self.days:
            self.days[key] = self._blank()
            for old in sorted(self.days)[:-self.KEEP_DAYS]:
                del self.days[old]
        return self.days[key]

    def _buckets(self) -> tuple[dict[str, Any], dict[str, Any]]:
        return self._today(), self.total

    def _touch_ip(self, bucket: dict[str, Any], ip: str) -> None:
        if len(bucket["ips"]) < 50_000:
            bucket["ips"].add(ip)

    def record_scan(self, ip: str, report: dict[str, Any]) -> None:
        for b in self._buckets():
            b["scans"] += 1
            b["grades"][report.get("grade", "F")] = b["grades"].get(report.get("grade", "F"), 0) + 1
            platform = (report.get("tech") or {}).get("platform", "generic")
            b["platforms"][platform] = b["platforms"].get(platform, 0) + 1
            b["scan_ms_sum"] += int((report.get("details") or {}).get("total_ms", 0) or 0)
            self._touch_ip(b, ip)

    def record_scan_outcome(self, ip: str, kind: str) -> None:
        """kind: rejected（授權/格式/SSRF）| rate_limited | failed（目標連不上）"""
        for b in self._buckets():
            b[f"scans_{kind}"] += 1
            self._touch_ip(b, ip)

    def record_consult(self, ip: str, mode: str, followup: bool) -> None:
        for b in self._buckets():
            if followup:
                b["followups"] += 1
            else:
                b["consults"] += 1
                b["consults_llm" if mode == "llm" else "consults_fallback"] += 1
            self._touch_ip(b, ip)

    FEEDBACK_MAX_KEYS = 500

    def record_feedback(self, kind: str, item_id: str, vote: str) -> dict[str, int]:
        """修復 Prompt 的 👍👎：只累計「哪個項目有沒有幫助」，不記 IP、不記網址、不記內容。"""
        key = f"{kind}:{item_id}"
        if key not in self.feedback and len(self.feedback) >= self.FEEDBACK_MAX_KEYS:
            return {"up": 0, "down": 0}
        counts = self.feedback.setdefault(key, {"up": 0, "down": 0})
        counts[vote] += 1
        return dict(counts)

    def feedback_view(self) -> dict[str, Any]:
        items: list[dict[str, Any]] = []
        for key, c in self.feedback.items():
            kind, _, item_id = key.partition(":")
            total = c["up"] + c["down"]
            items.append({"kind": kind, "id": item_id, "up": c["up"], "down": c["down"], "helpful": round(c["up"] * 100 / total) if total else None})
        items.sort(key=lambda x: (-(x["up"] + x["down"]), x["id"]))
        return {"total_up": sum(c["up"] for c in self.feedback.values()), "total_down": sum(c["down"] for c in self.feedback.values()), "items": items[:30]}

    @staticmethod
    def _view(b: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in b.items() if k not in ("ips", "scan_ms_sum", "platforms")}
        out["unique_ips"] = len(b["ips"])
        out["avg_scan_ms"] = round(b["scan_ms_sum"] / b["scans"]) if b["scans"] else None
        out["top_platforms"] = [[k, v] for k, v in sorted(b["platforms"].items(), key=lambda kv: -kv[1])[:5]]
        return out

    def snapshot(self) -> dict[str, Any]:
        today = self._today()
        return {
            "started_at": self.started_at.isoformat(),
            "uptime_hours": round((datetime.now(UTC) - self.started_at).total_seconds() / 3600, 1),
            "today": self._view(today),
            "since_start": self._view(self.total),
            "feedback": self.feedback_view(),
            "daily": [{"date": d, "scans": b["scans"], "consults": b["consults"], "unique_ips": len(b["ips"])} for d, b in sorted(self.days.items())],
            "llm_budget": llm_budget.status(),
            "persistence": "upstash" if UPSTASH_URL and UPSTASH_TOKEN else "memory",
            "note": "不記錄目標網址" + ("；統計每 60 秒存到 Upstash，重啟後保留" if UPSTASH_URL and UPSTASH_TOKEN else "；記憶體統計，服務重啟或重新部署會歸零"),
        }

    @staticmethod
    def _dump(b: dict[str, Any]) -> dict[str, Any]:
        return {**{k: v for k, v in b.items() if k != "ips"}, "ips": sorted(b["ips"])[:5000]}

    @classmethod
    def _undump(cls, d: dict[str, Any]) -> dict[str, Any]:
        b = cls._blank()
        for k in b:
            if k == "ips":
                b["ips"] = set(d.get("ips") or [])
            elif k in ("grades", "platforms"):
                b[k] = {**b[k], **(d.get(k) or {})}
            else:
                b[k] = d.get(k, b[k])
        return b

    def export(self) -> dict[str, Any]:
        return {"started_at": self.started_at.isoformat(), "days": {k: self._dump(v) for k, v in self.days.items()}, "total": self._dump(self.total), "feedback": self.feedback}

    def load(self, data: dict[str, Any]) -> None:
        try:
            self.started_at = datetime.fromisoformat(data["started_at"])
            self.days = {k: self._undump(v) for k, v in (data.get("days") or {}).items()}
            self.total = self._undump(data.get("total") or {})
            self.feedback = {str(k): {"up": int(v.get("up", 0)), "down": int(v.get("down", 0))} for k, v in (data.get("feedback") or {}).items() if isinstance(v, dict)}
        except (KeyError, ValueError, TypeError) as exc:
            log.warning("統計狀態載入失敗，改用空白：%s", exc)


stats = UsageStats()


# ---------------------------------------------------------------------------
# 持久化：把統計、額度、徽章快取整包存到 Upstash Redis（REST），60 秒一次 + 關機時
# ---------------------------------------------------------------------------
async def kv_command(*cmd: Any) -> Any:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(UPSTASH_URL, headers={"Authorization": f"Bearer {UPSTASH_TOKEN}"}, json=list(cmd))
        r.raise_for_status()
        return r.json().get("result")


def export_state() -> dict[str, Any]:
    return {"saved_at": datetime.now(UTC).isoformat(), "stats": stats.export(), "budget": llm_budget.export(), "badges": badge_cache}


def import_state(data: dict[str, Any]) -> None:
    stats.load(data.get("stats") or {})
    llm_budget.load(data.get("budget") or {})
    badge_cache.update({k: v for k, v in (data.get("badges") or {}).items() if isinstance(v, dict)})


async def save_state() -> bool:
    if not (UPSTASH_URL and UPSTASH_TOKEN):
        return False
    try:
        await kv_command("SET", STATE_KEY, json.dumps(export_state(), ensure_ascii=False))
        return True
    except Exception as exc:
        log.warning("狀態存檔失敗：%s", exc)
        return False


async def load_state() -> bool:
    if not (UPSTASH_URL and UPSTASH_TOKEN):
        return False
    try:
        raw = await kv_command("GET", STATE_KEY)
        if raw:
            import_state(json.loads(raw))
            log.info("已從 Upstash 還原統計狀態（存於 %s）", json.loads(raw).get("saved_at"))
        return True
    except Exception as exc:
        log.warning("狀態載入失敗：%s", exc)
        return False


async def persist_loop() -> None:
    while True:
        await asyncio.sleep(60)
        await save_state()
