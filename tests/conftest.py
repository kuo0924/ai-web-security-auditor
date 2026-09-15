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

import main as m  # noqa: E402

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
    """每個 API 測試都用乾淨的限流器、額度與統計，且不碰真的 LLM。"""
    monkeypatch.setattr(m, "LLM_PROVIDER", "none")
    monkeypatch.setattr(m, "scan_limiter", m.SlidingWindowLimiter(3, 60))
    monkeypatch.setattr(m, "consult_limiter", m.SlidingWindowLimiter(10, 60))
    monkeypatch.setattr(m, "consult_hourly_limiter", m.SlidingWindowLimiter(30, 3600))
    monkeypatch.setattr(m, "llm_budget", m.DailyBudget(300, 2.0))
    monkeypatch.setattr(m, "stats", m.UsageStats())
    monkeypatch.setattr(m, "STATS_TOKEN", "")
    monkeypatch.setattr(m, "CF_BEACON_TOKEN", "")
    return m
