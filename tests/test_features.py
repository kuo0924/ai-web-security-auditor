"""多路徑掃描、徽章、Turnstile / API 金鑰、狀態持久化。"""
import asyncio
import json

from fastapi.testclient import TestClient

from conftest import fr, m


def test_normalize_extra_paths():
    assert m.normalize_extra_paths(["/login", " /dashboard ", "/", "//evil.com", "http://x/y", "/a b", "/login", "", "/x" * 120]) == ["/login", "/dashboard"]
    assert len(m.normalize_extra_paths([f"/p{i}" for i in range(10)])) == m.MAX_EXTRA_PATHS


def test_evaluate_merges_cookies_and_secrets_from_extra_pages():
    main_r = fr("https://site.example/", headers={"content-type": "text/html"}, body=b"<html>home</html>")
    login = fr("https://site.example/login", headers={"content-type": "text/html"}, body=b"<html><script>var k='AKIAIOSFODNN7EXAMPLE';</script></html>",
               cookies=["session=abc; Path=/; HttpOnly", "csrf=1; Path=/"])
    rep = m.evaluate(input_url="https://site.example/", main=main_r, http_probe=None, js_results=[],
                     env_result=fr("x", status=404), git_result=fr("x", status=404),
                     extra_pages=[("/login", login), ("/missing", fr("https://site.example/missing", status=404)), ("/boom", Exception("timeout"))])
    ids = {i["id"] for i in rep["issues"]}
    assert "cookie_secure" in ids and "cookie_httponly" in ids and "secret_leak" in ids
    assert "csrf（/login）" in next(i for i in rep["issues"] if i["id"] == "cookie_httponly")["evidence"]
    assert "頁面 /login" in next(i for i in rep["issues"] if i["id"] == "secret_leak")["evidence"]
    assert [p["path"] for p in rep["details"]["extra_pages"]] == ["/login", "/missing", "/boom"]
    assert any("/boom" in n for n in rep["details"]["notes"]) and any("/missing" in n for n in rep["details"]["notes"])


def test_own_site_hygiene(fresh_state, monkeypatch):
    """我們要求別人做到的，自己先做到：security.txt、HSTS、COOP、script-src 沒有 'unsafe-inline'、JS 在獨立檔案。"""
    c = TestClient(m.app)
    st = c.get("/.well-known/security.txt")
    assert st.status_code == 200 and "Contact: mailto:a112221040@mail.shu.edu.tw" in st.text and "Expires:" in st.text
    r = c.get("/")
    csp = r.headers["content-security-policy"]
    script_src = next(part for part in csp.split(";") if part.strip().startswith("script-src"))
    assert "'unsafe-inline'" not in script_src and "object-src 'none'" in csp
    assert r.headers["strict-transport-security"].startswith("max-age=31536000")
    assert r.headers["cross-origin-opener-policy"] == "same-origin"
    assert "<script>" not in r.text and 'src="/static/app.js"' in r.text
    assert c.get("/static/app.js").status_code == 200 and c.get("/static/stats.js").status_code == 200
    assert "mailto:a112221040@mail.shu.edu.tw" in r.text and "排除" in r.text
    # 自我體檢：用 evaluate() 對自己的回應打分，應該是 A 且沒有 csp_weak
    main_r = fr("https://ai-web-security-auditor.onrender.com/", headers=dict(r.headers), body=r.content)
    rep = m.evaluate(input_url="https://ai-web-security-auditor.onrender.com/", main=main_r, http_probe=None, js_results=[],
                     env_result=fr("x", status=404), git_result=fr("x", status=404), security_txt_result=fr("x", body=st.content, headers={"content-type": "text/plain"}))
    assert rep["grade"] == "A" and rep["score"] == 100, [i["id"] for i in rep["issues"]]
    assert "csp_weak" not in {i["id"] for i in rep["issues"]}


def test_excluded_host(fresh_state, monkeypatch):
    monkeypatch.setattr(m, "EXCLUDED_HOSTS", {"private.example"})
    assert m.is_excluded_host("private.example") and m.is_excluded_host("www.private.example") and not m.is_excluded_host("notprivate.example")
    c = TestClient(m.app)
    r = c.post("/api/scan", json={"url": "https://app.private.example/", "authorized": True})
    assert r.status_code == 400 and "擁有者已要求" in r.json()["detail"]


def test_badge_route(fresh_state):
    c = TestClient(m.app)
    r = c.get("/badge/nobody.example.svg")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml") and "not scanned" in r.text
    m.badge_cache["good.example"] = {"score": 92, "grade": "A", "at": "2026-09-16T00:00:00+00:00"}
    m.badge_cache["old.example"] = {"score": 92, "grade": "A", "at": "2020-01-01T00:00:00+00:00"}
    assert "A · 92/100" in c.get("/badge/good.example.svg").text
    assert "not scanned" in c.get("/badge/old.example").text
    assert c.get("/badge/bad host!").status_code == 400
    m.badge_cache.clear()


def test_turnstile_required_and_api_key_bypass(fresh_state, monkeypatch, report):
    c = TestClient(m.app)
    monkeypatch.setattr(m, "TURNSTILE_SECRET_KEY", "secret")
    monkeypatch.setattr(m, "TURNSTILE_SITE_KEY", "site")
    monkeypatch.setattr(m, "API_KEYS", {"ci-key"})
    calls = []

    async def fake_verify(token, ip):
        calls.append(token)
        return token == "good"
    monkeypatch.setattr(m, "verify_turnstile", fake_verify)

    assert c.get("/api/health").json()["turnstile_site_key"] == "site"
    assert c.post("/api/ai-consult", json={"scan": report}).status_code == 403
    assert c.post("/api/ai-consult", json={"scan": report, "turnstile_token": "bad"}).status_code == 403
    assert c.post("/api/ai-consult", json={"scan": report, "turnstile_token": "good"}).status_code == 200
    assert c.post("/api/ai-consult", json={"scan": report}, headers={"X-Api-Key": "ci-key"}).status_code == 200
    assert c.post("/api/ai-consult", json={"scan": report}, headers={"X-Api-Key": "wrong"}).status_code == 403
    r = c.post("/api/scan", json={"url": "http://10.0.0.1/", "authorized": True, "turnstile_token": "good"})
    assert r.status_code == 400 and "已拒絕" in r.json()["detail"]  # 驗證通過後才進到 SSRF 判斷
    assert calls == ["bad", "good", "good"]
    monkeypatch.setattr(m, "TURNSTILE_SECRET_KEY", "")
    assert c.post("/api/ai-consult", json={"scan": report}).status_code == 200


def test_state_export_import_roundtrip(fresh_state):
    m.stats.record_scan("1.1.1.1", {"grade": "B", "tech": {"platform": "nextjs"}, "details": {"total_ms": 900}})
    m.stats.record_consult("1.1.1.1", "llm", followup=False)
    m.llm_budget.take()
    m.llm_budget.record_usd(0.05)
    m.badge_cache["x.example"] = {"score": 70, "grade": "B", "at": "2026-09-16T00:00:00+00:00"}
    blob = json.dumps(m.export_state())
    assert "1.1.1.1" in blob  # IP 只在快照裡，不會進 /api/stats
    m.stats = m.UsageStats()
    m.llm_budget = m.DailyBudget(300, 2.0)
    m.badge_cache.clear()
    m.import_state(json.loads(blob))
    s = m.stats.snapshot()
    assert s["since_start"]["scans"] == 1 and s["since_start"]["consults_llm"] == 1 and s["since_start"]["unique_ips"] == 1
    assert s["since_start"]["top_platforms"] == [["nextjs", 1]]
    assert m.llm_budget.status()["used_today"] == 1 and abs(m.llm_budget.status()["claude_usd_today"] - 0.05) < 1e-9
    assert m.badge_cache["x.example"]["grade"] == "B"


def test_save_and_load_state_with_fake_kv(fresh_state, monkeypatch):
    store = {}

    async def fake_kv(*cmd):
        if cmd[0] == "SET":
            store[cmd[1]] = cmd[2]
            return "OK"
        return store.get(cmd[1])
    monkeypatch.setattr(m, "kv_command", fake_kv)
    monkeypatch.setattr(m, "UPSTASH_URL", "https://fake.upstash.io")
    monkeypatch.setattr(m, "UPSTASH_TOKEN", "t")
    m.stats.record_scan("2.2.2.2", {"grade": "A", "tech": {"platform": "vercel"}, "details": {"total_ms": 500}})
    assert asyncio.run(m.save_state()) is True and m.STATE_KEY in store
    m.stats = m.UsageStats()
    assert asyncio.run(m.load_state()) is True
    assert m.stats.snapshot()["since_start"]["scans"] == 1
    assert m.stats.snapshot()["persistence"] == "upstash"
    monkeypatch.setattr(m, "UPSTASH_URL", "")
    assert asyncio.run(m.save_state()) is False
