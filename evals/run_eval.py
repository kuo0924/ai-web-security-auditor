"""AI 顧問評測：對 evals/cases/*.json 跑 generate_consult()，用規則檢查輸出品質。

用法：
  python evals/run_eval.py                 # 真的呼叫 LLM（讀 .env 的供應商設定），6 個案例約 0.25 美元
  python evals/run_eval.py --dry           # 規則模式（fallback_consult），只驗結構，不花錢、不碰網路；CI 這樣跑
  python evals/run_eval.py --only nextjs   # 只跑名稱包含 nextjs 的案例
  python evals/run_eval.py --provider openai   # 指定供應商鏈（覆蓋 LLM_PROVIDER）
  python evals/run_eval.py --no-save       # 不寫 evals/runs/

期望欄位（evals/cases/*.json 的 expect）：
  risk_level_in        風險等級必須是其中之一（只在真 LLM 模式檢查）
  must_mention_any     每一組至少提到一個詞（在 summary / priority_actions / stack_note / fix_prompts 裡找，不分大小寫）
  must_not_mention     不該出現的詞（避免給錯平台的設定檔）
  fix_prompts_cover    這些扣分項一定要有對應的修復 Prompt（結構檢查，dry 模式也驗）
  max_priority_actions 優先行動條數上限（預設 6）
結束碼：全部通過 0，否則 1。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import pathlib
import sys
import time
from datetime import UTC, datetime

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES_DIR = ROOT / "evals" / "cases"
RUNS_DIR = ROOT / "evals" / "runs"
RISK_LEVELS = ("低", "中", "高", "危急")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dry", action="store_true", help="用規則模式，不呼叫 LLM")
    p.add_argument("--only", default="", help="只跑名稱包含此字串的案例")
    p.add_argument("--provider", default="", help="覆蓋 LLM_PROVIDER，例如 anthropic 或 openai")
    p.add_argument("--no-save", action="store_true", help="不把結果寫到 evals/runs/")
    return p.parse_args()


def text_blob(consult: dict) -> str:
    parts = [consult.get("summary") or "", consult.get("stack_note") or "", *(consult.get("priority_actions") or [])]
    for fp in consult.get("fix_prompts") or []:
        parts += [fp.get("title") or "", fp.get("prompt") or ""]
    return " ".join(parts).lower()


def check(consult: dict, expect: dict, structural_only: bool) -> list[str]:
    failures: list[str] = []
    for key in ("summary", "risk_level", "priority_actions"):
        if not consult.get(key):
            failures.append(f"缺少 {key}")
    if consult.get("risk_level") not in RISK_LEVELS:
        failures.append(f"risk_level 不合法：{consult.get('risk_level')!r}")
    fix_prompts = consult.get("fix_prompts") or []
    covered = {i for fp in fix_prompts for i in (fp.get("issue_ids") or ([fp["issue_id"]] if fp.get("issue_id") else []))}
    for iid in expect.get("fix_prompts_cover", []):
        if iid not in covered:
            failures.append(f"fix_prompts 沒涵蓋 {iid}（有：{sorted(covered)}）")
    for fp in fix_prompts:
        if len(fp.get("prompt") or "") < 40:
            failures.append(f"修復 Prompt 太短：{fp.get('title')!r}")
    if len(consult.get("priority_actions") or []) > expect.get("max_priority_actions", 6):
        failures.append(f"priority_actions 有 {len(consult['priority_actions'])} 條，超過上限")
    if structural_only:
        return failures

    blob = text_blob(consult)
    if expect.get("risk_level_in") and consult.get("risk_level") not in expect["risk_level_in"]:
        failures.append(f"risk_level={consult.get('risk_level')}，期望 {expect['risk_level_in']}")
    for group in expect.get("must_mention_any", []):
        if not any(term.lower() in blob for term in group):
            failures.append(f"沒提到任何一個：{group}")
    for term in expect.get("must_not_mention", []):
        if term.lower() in blob:
            failures.append(f"不該提到：{term}")
    return failures


def load_cases(only: str) -> list[dict]:
    cases = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(CASES_DIR.glob("*.json"))]
    return [c for c in cases if only.lower() in c["name"].lower()]


async def run_cases(cases: list[dict], dry: bool) -> list[dict]:
    """全部案例共用一個事件迴圈：Anthropic 的 async client 是模組層單例，每案各開一個迴圈會讓連線池失效而重試。"""
    from advisor import fallback_consult, generate_consult, scan_digest  # config 讀環境變數，要在 main() 設定後才 import

    results = []
    for case in cases:
        scan, expect = case["scan"], case["expect"]
        t0 = time.perf_counter()
        consult = fallback_consult(scan, scan_digest(scan), "評測 dry run") if dry else await generate_consult(scan)
        seconds = round(time.perf_counter() - t0, 1)
        failures = check(consult, expect, structural_only=dry)
        if not dry and consult.get("mode") != "llm":
            failures.insert(0, f"LLM 沒回應，降級成規則模式：{consult.get('note')}")
        usd = float(consult.get("usd") or 0)
        results.append({
            "name": case["name"], "ok": not failures, "failures": failures, "seconds": seconds,
            "provider": consult.get("provider"), "model": consult.get("model"), "usd": usd,
            "risk_level": consult.get("risk_level"), "summary": (consult.get("summary") or "")[:160],
            "fix_prompt_ids": [fp.get("issue_ids") or fp.get("issue_id") for fp in consult.get("fix_prompts") or []],
            "consult": consult,
        })
        tag = "PASS" if not failures else "FAIL"
        print(f"[{tag}] {case['name']:<38} {consult.get('risk_level') or '-':<3} {seconds:>5}s  {consult.get('model') or 'rules'}" + (f"  ${usd:.4f}" if usd else ""))
        for f in failures:
            print(f"       - {f}")
    return results


def main() -> int:
    args = parse_args()
    if args.dry:
        os.environ["LLM_PROVIDER"] = "none"
    elif args.provider:
        os.environ["LLM_PROVIDER"] = args.provider
    sys.path.insert(0, str(ROOT))

    cases = load_cases(args.only)
    if not cases:
        print("沒有符合的案例；先執行 python evals/build_cases.py")
        return 1
    mode = "dry" if args.dry else "llm"
    results = asyncio.run(run_cases(cases, args.dry))
    total_usd = sum(r["usd"] for r in results)
    passed = sum(r["ok"] for r in results)
    print()
    print(f"{passed}/{len(results)} 通過 · 模式 {mode}" + (f" · 共 ${total_usd:.4f}" if total_usd else ""))

    if not args.no_save:
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        out = RUNS_DIR / f"{stamp}-{mode}.json"
        out.write_text(json.dumps({"at": stamp, "mode": mode, "passed": passed, "total": len(results), "usd": round(total_usd, 4), "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"結果已存：{out.relative_to(ROOT)}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
