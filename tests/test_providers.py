"""AI 顧問供應商鏈：Claude 官方 SDK（模擬）、Gemini 相容端點（模擬）、模型備援、額度、拒答、降級。不碰網路。"""
import asyncio
import json

import anthropic
import httpx
import pytest
from conftest import m, patch_all
from starlette.requests import Request

GOOD = json.dumps({"summary": "ok", "risk_level": "中", "priority_actions": ["a"],
                   "fix_prompts": [{"issue_ids": ["csp"], "title": "t", "prompt": "p"}], "stack_note": "n"})


class _Block:
    def __init__(self, text):
        self.type, self.text = "text", text


class _Usage:
    def __init__(self, i, o, cr=0, cw=0):
        self.input_tokens, self.output_tokens, self.cache_read_input_tokens, self.cache_creation_input_tokens = i, o, cr, cw


class _Resp:
    def __init__(self, text, stop="end_turn", usage=None):
        self.content, self.stop_reason, self.usage = [_Block(text)], stop, usage or _Usage(4000, 1500)


class FakeAnthropic:
    """messages.create 的行為由 mode 決定：ok | 429 | auth | refusal。"""

    def __init__(self):
        self.mode, self.calls = "ok", []
        self.messages = self

    async def create(self, **kw):
        self.calls.append(kw)
        req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        if self.mode == "429":
            raise anthropic.RateLimitError("rl", response=httpx.Response(429, request=req), body=None)
        if self.mode == "auth":
            raise anthropic.AuthenticationError("bad key", response=httpx.Response(401, request=req), body=None)
        if self.mode == "refusal":
            return _Resp("", stop="refusal")
        return _Resp(GOOD)


def make_fake_httpx(handler):
    class FakeClient:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            pass

        async def post(self, url, headers=None, json=None):
            return handler(url, json)
    return FakeClient


def gemini_ok(url, payload):
    return httpx.Response(200, request=httpx.Request("POST", url),
                          json={"choices": [{"message": {"content": GOOD}, "finish_reason": "stop"}]})


@pytest.fixture
def providers(monkeypatch):
    fake = FakeAnthropic()
    patch_all(monkeypatch, "LLM_PROVIDER", "anthropic,openai")
    patch_all(monkeypatch, "ANTHROPIC_API_KEY", "sk-ant-test")
    patch_all(monkeypatch, "ANTHROPIC_MODEL", "claude-sonnet-5")
    patch_all(monkeypatch, "OPENAI_API_KEY", "gem-test")
    patch_all(monkeypatch, "OPENAI_MODELS", ["gemini-x"])
    patch_all(monkeypatch, "OPENAI_MODEL", "gemini-x")
    patch_all(monkeypatch, "_anthropic_client", fake)
    patch_all(monkeypatch, "llm_budget", m.DailyBudget(100, 0.10))
    monkeypatch.setattr(m.httpx, "AsyncClient", make_fake_httpx(gemini_ok))
    return fake


def test_claude_structured_cached_and_costed(providers, report):
    assert m.configured_providers() == ["anthropic", "openai"]
    r = asyncio.run(m.generate_consult(report))
    kw = providers.calls[-1]
    assert r["mode"] == "llm" and r["provider"] == "anthropic" and r["model"] == "claude-sonnet-5"
    assert kw["output_config"]["format"]["type"] == "json_schema" and kw["output_config"]["effort"] == "medium"
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"} and len(kw["system"]) == 2
    expected = (4000 * 2 + 1500 * 10) / 1e6
    assert abs(r["usd"] - expected) < 1e-6 and abs(m.llm_budget.usd - expected) < 1e-6
    assert r["fix_prompts"][0]["issue_ids"] == ["csp"]


def test_cost_estimates():
    assert abs(m.estimate_claude_cost("claude-sonnet-5", _Usage(500, 1000, cr=3000)) - (500 * 2 + 1000 * 10 + 3000 * 0.2) / 1e6) < 1e-9
    assert abs(m.estimate_claude_cost("claude-opus-5", _Usage(1000, 0)) - 0.005) < 1e-9


@pytest.mark.parametrize("mode", ["429", "auth", "refusal"])
def test_claude_failure_falls_back_to_gemini(providers, report, mode):
    providers.mode = mode
    r = asyncio.run(m.generate_consult(report))
    assert r["mode"] == "llm" and r["provider"] == "openai" and r["model"] == "gemini-x"


def test_usd_cap_skips_claude(providers, report):
    m.llm_budget._roll()  # 先建立今天的日界，否則第一次檢查會把 usd 歸零
    m.llm_budget.usd = 0.10
    n = len(providers.calls)
    r = asyncio.run(m.generate_consult(report))
    assert r["provider"] == "openai" and len(providers.calls) == n


def test_followup_uses_claude_without_schema(providers, report):
    r = asyncio.run(m.answer_followup(report, "hi", []))
    kw = providers.calls[-1]
    assert r["provider"] == "anthropic" and "format" not in kw["output_config"] and kw["messages"][-1]["content"] == "hi"


def test_all_providers_down_uses_rules(providers, report, monkeypatch):
    providers.mode = "429"
    monkeypatch.setattr(m.httpx, "AsyncClient", make_fake_httpx(lambda url, p: httpx.Response(503, request=httpx.Request("POST", url), json={})))
    r = asyncio.run(m.generate_consult(report))
    assert r["mode"] == "fallback"


def test_provider_order_and_none(monkeypatch):
    patch_all(monkeypatch, "ANTHROPIC_API_KEY", "")
    patch_all(monkeypatch, "OPENAI_API_KEY", "x")
    patch_all(monkeypatch, "LLM_PROVIDER", "auto")
    assert m.configured_providers() == ["openai"]
    patch_all(monkeypatch, "LLM_PROVIDER", "none")
    assert m.configured_providers() == []


def test_gemini_model_fallback_chain(monkeypatch, report):
    seen = []

    def handler(url, payload):
        seen.append(payload["model"])
        req = httpx.Request("POST", url)
        if payload["model"] == "first":
            return httpx.Response(429, request=req, json={"error": "quota"})
        if payload["model"] == "second":
            return httpx.Response(503, request=req, json={"error": "overloaded"})
        return gemini_ok(url, payload)

    patch_all(monkeypatch, "LLM_PROVIDER", "openai")
    patch_all(monkeypatch, "OPENAI_API_KEY", "test")
    patch_all(monkeypatch, "ANTHROPIC_API_KEY", "")
    patch_all(monkeypatch, "OPENAI_MODELS", ["first", "second", "third"])
    patch_all(monkeypatch, "llm_budget", m.DailyBudget(2, 0))
    monkeypatch.setattr(m.httpx, "AsyncClient", make_fake_httpx(handler))
    text, meta = asyncio.run(m.llm_complete("s", [{"role": "user", "content": "u"}], json_schema={"type": "object"}))
    assert meta["model"] == "third" and seen == ["first", "second", "third"]
    r = asyncio.run(m.generate_consult(report))
    assert r["mode"] == "llm" and r["model"] == "third"
    r = asyncio.run(m.generate_consult(report))
    assert r["mode"] == "fallback" and "額度" in r["note"]
    r = asyncio.run(m.answer_followup(report, "hi", []))
    assert r["mode"] == "fallback" and "額度" in r["answer"]
    m.llm_budget.limit = 0
    assert m.llm_budget.take()


def test_json_helpers(report):
    assert m.extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert m.extract_json('前言 {"a": {"b": 2}} 後記') == {"a": {"b": 2}}
    out = m.normalize_consult({"summary": "x", "fix_prompts": [{"issue_ids": ["hsts", "https"], "title": "merged", "prompt": "p"}, {"issue_id": "csp", "prompt": "q"}]}, report)
    ids = [p["issue_ids"] for p in out["fix_prompts"]]
    assert ids[0] == ["hsts", "https"] and ids[1] == ["csp"]
    covered = {i for p in out["fix_prompts"] for i in p["issue_ids"]}
    assert {i["id"] for i in report["issues"] if i["penalty"] > 0} <= covered
    turns = m._collapse_turns([{"role": "user", "content": "a"}, {"role": "user", "content": "b"}, {"role": "assistant", "content": "c"}])
    assert [t["role"] for t in turns] == ["user", "assistant"] and turns[0]["content"] == "a\n\nb"


def _req(headers, client=("10.0.0.5", 0)):
    return Request({"type": "http", "headers": [(k.encode(), v.encode()) for k, v in headers.items()], "client": client, "method": "GET", "path": "/", "query_string": b""})


def test_client_ip_behind_proxy(monkeypatch):
    patch_all(monkeypatch, "TRUST_PROXY", True)
    assert m.client_ip(_req({"x-forwarded-for": "1.1.1.1, 10.20.0.3"})) == "1.1.1.1"
    assert m.client_ip(_req({"x-forwarded-for": "9.9.9.9, 1.1.1.1, 10.20.0.3"})) == "1.1.1.1"
    assert m.client_ip(_req({"cf-connecting-ip": "8.8.8.8", "x-forwarded-for": "9.9.9.9, 1.1.1.1"})) == "8.8.8.8"
    assert m.client_ip(_req({"x-forwarded-for": "10.1.1.1, 10.2.2.2"})) == "10.2.2.2"
    assert m.client_ip(_req({})) == "10.0.0.5"
    patch_all(monkeypatch, "TRUST_PROXY", False)
    assert m.client_ip(_req({"x-forwarded-for": "1.1.1.1"})) == "10.0.0.5"
