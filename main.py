"""
AI 網站安全體檢儀 + 智慧資安顧問
AI-Powered Passive Web Security Auditor
========================================

三層混合架構（模組拆分後 main.py 只剩 API 層，見各模組檔頭）：
  1. 硬規則檢測層（Scanner）  ─ 純被動、確定性、毫秒級、不用 LLM。
  2. AI 顧問層（Advisor）      ─ 把檢測 JSON 交給 LLM 產生白話診斷與修復 Prompt，支援追問。
  3. 知識庫層（KnowledgeBase） ─ knowledge/ 目錄以標籤檢索補充上下文，之後可替換成向量 RAG。

法律邊界（最高優先）：
  * 只送出一般瀏覽器也會送的 GET 請求：首頁、站內前 2 個 JS、/.env、/.git/config、http:// 轉址探測。
  * 不注入、不爆破、不掃 port、不跟隨轉址進入內網。
  * 目標網域解析出的「每一個」IP 都必須是公開位址，且實際連線釘選到已驗證的 IP（防 DNS Rebinding）。
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Optional
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from advisor import *  # noqa: F401,F403
from advisor import _collapse_turns  # noqa: F401
from config import *  # noqa: F401,F403
from knowledge import *  # noqa: F401,F403
from netsafe import *  # noqa: F401,F403
from netsafe import _ip_is_public  # noqa: F401
from scanner import *  # noqa: F401,F403
from state import *  # noqa: F401,F403


def _is_public_ip(value: str) -> bool:
    try:
        return _ip_is_public(ipaddress.ip_address(value))
    except ValueError:
        return False


def client_ip(request: Request) -> str:
    if TRUST_PROXY:
        # Cloudflare / Render 這類平台會用專屬標頭給真實來源，最可靠
        for name in ("cf-connecting-ip", "true-client-ip", "x-real-ip"):
            v = (request.headers.get(name) or "").strip()
            if v and _is_public_ip(v):
                return v
        xff = request.headers.get("x-forwarded-for")
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            # 從右往左跳過內部代理（私有位址），取第一個公開位址；
            # 最左邊可以被客戶端自己偽造，所以不從左邊取
            for p in reversed(parts):
                if _is_public_ip(p):
                    return p
            if parts:
                return parts[-1]
    return request.client.host if request.client else "unknown"



# ---------------------------------------------------------------------------
# 7. FastAPI 應用
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    await load_state()
    task = asyncio.create_task(persist_loop()) if (UPSTASH_URL and UPSTASH_TOKEN) else None
    try:
        yield
    finally:
        if task:
            task.cancel()
        await save_state()


app = FastAPI(
    title="網站安全體檢儀 API",
    version="1.1.0",
    description=(
        "被動式網站安全檢測。`POST /api/scan` 只送一般瀏覽器也會送的 GET 請求，不做注入、爆破或掃描；"
        "呼叫者必須是目標網站的擁有者或已取得授權。每個來源 IP 每分鐘 3 次。"
        "部署端若啟用 Turnstile，自動化呼叫請帶 `X-Api-Key`。"
    ),
    docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None, lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
MAX_BODY_BYTES = 1_000_000  # 報告 JSON 通常 30–60 KB，1 MB 綽綽有餘
REPORT_CACHE_TTL = 45  # 同一目標短時間內重複掃描直接回快取，減少對目標網站的請求
report_cache: dict[tuple[str, tuple[str, ...], bool], tuple[float, dict[str, Any]]] = {}  # (target, paths, auto_paths)


class ScanRequest(BaseModel):
    url: str = Field(..., max_length=2048)
    authorized: bool = False
    paths: list[str] = Field(default_factory=list, max_length=MAX_EXTRA_PATHS)
    auto_paths: bool = False  # 從 sitemap.xml 自動補到最多 MAX_EXTRA_PATHS 個站內路徑
    turnstile_token: Optional[str] = Field(None, max_length=4096)


class ChatTurn(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., max_length=4000)


class ConsultRequest(BaseModel):
    scan: dict[str, Any]
    question: Optional[str] = Field(None, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    turnstile_token: Optional[str] = Field(None, max_length=4096)


class FeedbackRequest(BaseModel):
    kind: Literal["issue", "ai", "snippet"]  # 規則修復 Prompt｜AI 架構專屬 Prompt｜設定檔片段
    issue_id: str = Field(..., min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_+./-]+$")
    vote: Literal["up", "down"]


async def verify_turnstile(token: str, ip: str) -> bool:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={"secret": TURNSTILE_SECRET_KEY, "response": token, "remoteip": ip},
        )
        return bool(r.status_code == 200 and r.json().get("success"))


async def require_human(request: Request, token: Optional[str], ip: str) -> None:
    """Turnstile 啟用時，掃描與 AI 顧問都要帶有效 token；帶合法 X-Api-Key 的自動化呼叫可跳過。"""
    if not TURNSTILE_SECRET_KEY:
        return
    api_key = request.headers.get("x-api-key", "")
    if api_key and api_key in API_KEYS:
        return
    if not token:
        raise HTTPException(status_code=403, detail="需要完成人機驗證，請重新整理頁面再試")
    try:
        ok = await verify_turnstile(token, ip)
    except Exception as exc:
        log.warning("Turnstile 驗證服務錯誤：%s", exc)
        ok = False
    if not ok:
        raise HTTPException(status_code=403, detail="人機驗證失敗，請重新整理頁面再試")


OWN_SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    # 自己的 JS 都在 static/ 檔案裡，script-src 不需要 'unsafe-inline'（我們對別人的要求，自己先做到）
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; "
        "img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
    ),
}


def asset_version() -> str:
    """static/ 檔案內容的短雜湊：頁面引用 /static/x.js?v=<hash>，改版後瀏覽器一定拿到新檔，沒改版就能長期快取。"""
    h = hashlib.sha256()
    for name in ("app.js", "stats.js", "tailwind.css"):
        try:
            h.update((BASE_DIR / "static" / name).read_bytes())
        except OSError:
            pass
    return h.hexdigest()[:10]


ASSET_VERSION = asset_version()


def render_page(filename: str, request: Request) -> Response:
    """讀靜態頁、把 /static/ 引用加上版本參數，並在 <!--CF_BEACON--> 注入 Cloudflare Web Analytics 腳本（有設 token 才注入）。"""
    if request.method == "HEAD":
        return Response(status_code=200, media_type="text/html; charset=utf-8")
    html = (BASE_DIR / filename).read_text(encoding="utf-8")
    beacon = ""
    if CF_BEACON_TOKEN:
        token = json.dumps(CF_BEACON_TOKEN)  # 逸出成 JSON 字串，避免 token 內容破壞屬性
        beacon = f"<script type=\"module\" src=\"https://static.cloudflareinsights.com/beacon.min.js\" data-cf-beacon='{{\"token\": {token}}}'></script>"
    html = html.replace("<!--CF_BEACON-->", beacon)
    for name in ("tailwind.css", "app.js", "stats.js"):
        html = html.replace(f'"/static/{name}"', f'"/static/{name}?v={ASSET_VERSION}"')
    return HTMLResponse(html)


@app.middleware("http")
async def own_security_headers(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": "請求內容過大"})
    response = await call_next(request)
    for k, v in OWN_SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    if request.url.path.startswith("/static/"):
        # 帶版本參數的引用可以永久快取；直接打 /static/x.js 的每次都重新驗證，避免部署後拿到舊檔
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if request.query_params.get("v") == ASSET_VERSION else "no-cache"
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("未處理的錯誤：%s", exc)
    return JSONResponse(status_code=500, content={"detail": "伺服器內部錯誤，請稍後再試"})


@app.api_route("/", methods=["GET", "HEAD"])
async def index(request: Request):
    return render_page("index.html", request)


@app.api_route("/stats", methods=["GET", "HEAD"])
async def stats_page(request: Request):
    """給人看的使用量頁面（資料來自 /api/stats）。"""
    return render_page("stats.html", request)


@app.get("/api/sample")
async def api_sample():
    """範例報告（虛構網站，含預先產生的 AI 顧問結果），讓訪客不用掃描就能看到成品。"""
    return FileResponse(BASE_DIR / "sample_report.json", media_type="application/json; charset=utf-8", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/favicon.ico")
@app.get("/favicon.svg")
async def favicon():
    return FileResponse(BASE_DIR / "static" / "favicon.svg", media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/og.png")
async def og_image():
    return FileResponse(BASE_DIR / "static" / "og.png", media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/robots.txt")
async def robots_txt():
    return Response(f"User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /stats\nDisallow: /badge/\nSitemap: {PUBLIC_ORIGIN}/sitemap.xml\n", media_type="text/plain; charset=utf-8", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/sitemap.xml")
async def sitemap_xml():
    body = ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            f'<url><loc>{PUBLIC_ORIGIN}/</loc><changefreq>weekly</changefreq></url>'
            f'<url><loc>{PUBLIC_ORIGIN}/stats</loc><changefreq>daily</changefreq></url></urlset>\n')
    return Response(body, media_type="application/xml; charset=utf-8", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/.well-known/security.txt")
async def security_txt():
    """我們要求別人提供的東西，自己也要有（RFC 9116）。"""
    expires = (datetime.now(UTC) + timedelta(days=365)).strftime("%Y-%m-%dT00:00:00.000Z")
    body = (
        f"Contact: mailto:{CONTACT_EMAIL}\n"
        f"Expires: {expires}\n"
        "Preferred-Languages: zh-TW, en\n"
        f"Canonical: {PUBLIC_ORIGIN}/.well-known/security.txt\n"
        f"Policy: {PUBLIC_ORIGIN}/#footer\n"
    )
    return Response(body, media_type="text/plain; charset=utf-8", headers={"Cache-Control": "public, max-age=86400"})


@app.api_route("/api/health", methods=["GET", "HEAD"])  # 監控服務常用 HEAD，只開 GET 會回 405 被判成掛掉
async def health(request: Request):
    ua = request.headers.get("user-agent", "")
    if "uptimerobot" in ua.lower():  # 讓 Render log 搜 "keepalive" 就能確認外部監控有在敲
        log.info("keepalive ping from %s via %s (%s)", client_ip(request), request.method, ua[:40])
    providers = configured_providers()
    provider = providers[0] if providers else "none"
    return {
        "ok": True,
        "commit": GIT_COMMIT,
        "llm_provider": provider,
        "llm_providers_order": providers,
        "llm_model": {"openai": OPENAI_MODEL, "anthropic": ANTHROPIC_MODEL}.get(provider),
        "llm_models_fallback": (["anthropic:" + ANTHROPIC_MODEL] if "anthropic" in providers else []) + (["openai:" + m for m in OPENAI_MODELS] if "openai" in providers else []),
        "llm_budget": llm_budget.status(),
        # 只給長度，用來確認部署平台上貼的金鑰是否完整（不會洩漏內容）
        "key_lengths": {"anthropic": len(ANTHROPIC_API_KEY), "openai": len(OPENAI_API_KEY)},
        "knowledge_docs": len(KB.docs),
        "scan_rate_limit_per_min": SCAN_RATE_LIMIT[0],
        "turnstile_site_key": TURNSTILE_SITE_KEY if TURNSTILE_SECRET_KEY else "",
        "persistence": "upstash" if UPSTASH_URL and UPSTASH_TOKEN else "memory",
        "max_extra_paths": MAX_EXTRA_PATHS,
    }


BADGE_COLORS = {"A": "#10b981", "B": "#6366f1", "C": "#f59e0b", "F": "#f43f5e"}


def badge_svg(label: str, value: str, color: str) -> str:
    lw, vw = 7 * len(label) + 12, 7 * len(value) + 12
    w = lw + vw
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="20" role="img" aria-label="{label}: {value}">'
        f'<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>'
        f'<clipPath id="r"><rect width="{w}" height="20" rx="3" fill="#fff"/></clipPath>'
        f'<g clip-path="url(#r)"><rect width="{lw}" height="20" fill="#1e293b"/><rect x="{lw}" width="{vw}" height="20" fill="{color}"/><rect width="{w}" height="20" fill="url(#s)"/></g>'
        f'<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">'
        f'<text x="{lw / 2}" y="15" fill="#010101" fill-opacity=".3">{label}</text><text x="{lw / 2}" y="14">{label}</text>'
        f'<text x="{lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">{value}</text><text x="{lw + vw / 2}" y="14">{value}</text></g></svg>'
    )


@app.get("/badge/{host}")
async def badge(host: str):
    """A 級徽章：只顯示經授權掃描過、7 天內的結果；沒掃過就是灰色的「not scanned」。"""
    h = host.lower().removesuffix(".svg")
    if not re.fullmatch(r"[a-z0-9.-]{1,253}", h):
        raise HTTPException(status_code=400, detail="host 格式錯誤")
    entry = badge_cache.get(h)
    fresh = False
    if entry:
        try:
            fresh = (datetime.now(UTC) - datetime.fromisoformat(entry["at"])).days < 7
        except (KeyError, ValueError):
            fresh = False
    if entry and fresh:
        svg = badge_svg("web security", f"{entry['grade']} · {entry['score']}/100", BADGE_COLORS.get(entry["grade"], "#6b7280"))
    else:
        svg = badge_svg("web security", "not scanned", "#6b7280")
    return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/whoami")
async def whoami(request: Request):
    """回報呼叫者自己被辨識成哪個 IP，用來確認反向代理後的限流鍵是否正確。"""
    return {
        "rate_limit_key": client_ip(request),
        "trust_proxy": TRUST_PROXY,
        "socket_peer": request.client.host if request.client else None,
        "headers": {k: request.headers.get(k) for k in ("x-forwarded-for", "cf-connecting-ip", "true-client-ip", "x-real-ip")},
    }


@app.get("/api/stats")
async def api_stats(request: Request):
    """使用量彙總（不含任何目標網址）。設定 STATS_TOKEN 後需帶 ?token=。"""
    if STATS_TOKEN and request.query_params.get("token") != STATS_TOKEN:
        raise HTTPException(status_code=403, detail="需要正確的 token")
    return stats.snapshot()


@app.post("/api/scan")
async def api_scan(body: ScanRequest, request: Request):
    ip = client_ip(request)
    if not body.authorized:
        stats.record_scan_outcome(ip, "rejected")
        raise HTTPException(status_code=400, detail="請先確認你具備檢測此網站的授權")
    try:
        target = normalize_target(body.url)
    except ValueError as exc:
        stats.record_scan_outcome(ip, "rejected")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if is_excluded_host(urlparse(target).hostname or ""):
        stats.record_scan_outcome(ip, "rejected")
        raise HTTPException(status_code=400, detail="此網域的擁有者已要求不被本工具檢測")

    allowed, retry_after = scan_limiter.hit(ip)
    if not allowed:
        stats.record_scan_outcome(ip, "rate_limited")
        raise HTTPException(
            status_code=429,
            detail=f"每分鐘最多檢測 {SCAN_RATE_LIMIT[0]} 次，請 {retry_after} 秒後再試",
            headers={"Retry-After": str(retry_after)},
        )
    await require_human(request, body.turnstile_token, ip)

    cache_key = (target, tuple(normalize_extra_paths(body.paths)), body.auto_paths)
    cached = report_cache.get(cache_key)
    if cached and time.time() - cached[0] < REPORT_CACHE_TTL:
        age = int(time.time() - cached[0])
        report = json.loads(json.dumps(cached[1]))
        report["details"]["notes"] = [f"這是 {age} 秒前的快取結果（同一目標 {REPORT_CACHE_TTL} 秒內不重複請求）；若剛改完設定，請稍後再掃一次", *report["details"].get("notes", [])]
        report["details"]["cached_seconds"] = age
        stats.record_scan(ip, report)
        return report
    for key, (ts, _) in list(report_cache.items()):
        if time.time() - ts >= REPORT_CACHE_TTL:
            report_cache.pop(key, None)

    log.info("scan %s -> %s%s%s", ip, urlparse(target).hostname, f" (+{len(body.paths)} paths)" if body.paths else "", " (auto)" if body.auto_paths else "")
    # 使用者沒打協定時先試 https://，連不上再退回 http://（結果會如實反映該站沒有 HTTPS）
    candidates = [target]
    if "://" not in body.url.strip():
        candidates.append("http://" + target[len("https://"):])
    last_error: TargetUnreachable | None = None
    try:
        for candidate in candidates:
            try:
                report = await run_scan(candidate, body.paths, auto_paths=body.auto_paths)
                stats.record_scan(ip, report)
                host = (report.get("target") or {}).get("hostname")
                if host:
                    badge_cache[host] = {"score": report["score"], "grade": report["grade"], "at": report["scanned_at"]}
                report_cache[cache_key] = (time.time(), report)
                return report
            except TargetUnreachable as exc:
                last_error = exc
    except SSRFBlocked as exc:
        stats.record_scan_outcome(ip, "rejected")
        raise HTTPException(status_code=400, detail=f"已拒絕：{exc}") from exc
    stats.record_scan_outcome(ip, "failed")
    raise HTTPException(status_code=502, detail=f"無法完成檢測：{last_error}")


@app.post("/api/ai-consult")
async def api_ai_consult(body: ConsultRequest, request: Request):
    ip = client_ip(request)
    allowed, retry_after = consult_limiter.hit(ip)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"AI 顧問每分鐘最多 {CONSULT_RATE_LIMIT[0]} 次，請 {retry_after} 秒後再試",
            headers={"Retry-After": str(retry_after)},
        )
    allowed, retry_after = consult_hourly_limiter.hit(ip)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"AI 顧問每小時最多 {CONSULT_HOURLY_LIMIT} 次，請 {retry_after // 60 + 1} 分鐘後再試",
            headers={"Retry-After": str(retry_after)},
        )
    if not body.scan.get("issues") and not body.scan.get("passed"):
        raise HTTPException(status_code=400, detail="請先完成一次網站體檢")
    await require_human(request, body.turnstile_token, ip)
    if body.question and body.question.strip():
        history = [t.model_dump() for t in body.history]
        result = await answer_followup(body.scan, body.question.strip(), history)
        stats.record_consult(ip, result.get("mode", "fallback"), followup=True)
        return result
    result = await generate_consult(body.scan)
    stats.record_consult(ip, result.get("mode", "fallback"), followup=False)
    return result


@app.post("/api/feedback")
async def api_feedback(body: FeedbackRequest, request: Request):
    """修復 Prompt 的 👍👎：只累計「kind:id」的正負計數（進 /api/stats 與狀態快照），不記 IP、不記網址。"""
    ip = client_ip(request)
    allowed, retry_after = feedback_limiter.hit(ip)
    if not allowed:
        raise HTTPException(status_code=429, detail=f"回饋太頻繁，請 {retry_after} 秒後再試", headers={"Retry-After": str(retry_after)})
    counts = stats.record_feedback(body.kind, body.issue_id, body.vote)
    return {"ok": True, "kind": body.kind, "id": body.issue_id, **counts}


@app.post("/api/knowledge/reload")
async def api_knowledge_reload():
    """編輯 knowledge/ 內容後不用重啟即可生效。"""
    KB.reload()
    return {"ok": True, "docs": [d["name"] for d in KB.docs], "fewshot": len(KB.fewshot)}


if __name__ == "__main__":  # python main.py 也能直接啟動
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=int(os.getenv("PORT", "8000")), reload=True)
