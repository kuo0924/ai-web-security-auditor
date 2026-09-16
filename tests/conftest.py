"""共用的測試設定：把專案根目錄加進 sys.path，並提供合成 FetchResult 與範例報告。"""
import json
import os
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("LLM_PROVIDER", "none")

import advisor  # noqa: E402,E401
import config
import knowledge
import main as m  # noqa: E402
import netsafe
import scanner
import state

MODULES = (config, netsafe, scanner, knowledge, state, advisor, m)


def patch_all(monkeypatch, name, value):
    """拆模組後同一個名稱會被 star import 到多個模組，要一起換掉才有效。"""
    hit = False
    for mod in MODULES:
        if hasattr(mod, name):
            monkeypatch.setattr(mod, name, value)
            hit = True
    assert hit, f"no module has attribute {name}"

FIXTURES = Path(__file__).parent / "fixtures"


def fr(url, status=200, headers=None, body=b"", cookies=None, hops=None, tls=None):
    """合成一個 FetchResult，讓 evaluate() 不用碰網路。"""
    return m.FetchResult(
        url=url, status=status, headers=httpx.Headers(headers or {}), body=body,
        hops=hops or [], set_cookies=cookies or [], tls_not_after=tls,
    )


@pytest.fixture
def report():
    return json.loads((FIXTURES / "example_report.json").read_text(encoding="utf-8"))


@pytest.fixture
def fresh_state(monkeypatch):
    """每個 API 測試都用乾淨的限流器、額度與統計，且不碰真的 LLM。回傳 patch(name, value) 方便測試內再改。"""
    def patch(name, value):
        patch_all(monkeypatch, name, value)
    patch("LLM_PROVIDER", "none")
    patch("scan_limiter", m.SlidingWindowLimiter(3, 60))
    patch("consult_limiter", m.SlidingWindowLimiter(10, 60))
    patch("consult_hourly_limiter", m.SlidingWindowLimiter(30, 3600))
    patch("llm_budget", m.DailyBudget(300, 2.0))
    patch("stats", m.UsageStats())
    patch("STATS_TOKEN", "")
    patch("CF_BEACON_TOKEN", "")
    return patch
