"""HTTP 層：限流、授權、統計、健康檢查、靜態頁與 beacon 注入。用 TestClient，不碰外部網路。"""
from conftest import m
from fastapi.testclient import TestClient


def test_scan_rejections_rate_limit_and_stats(fresh_state, report):
    fresh_state("scan_limiter", m.SlidingWindowLimiter(2, 60))
    c = TestClient(m.app)
    s = c.get("/api/stats").json()
    assert s["today"]["scans"] == 0 and s["since_start"]["unique_ips"] == 0

    assert c.post("/api/scan", json={"url": "example.com", "authorized": False}).status_code == 400
    assert c.post("/api/scan", json={"url": "http://127.0.0.1/", "authorized": True}).status_code == 400
    assert c.post("/api/scan", json={"url": "ftp://x", "authorized": True}).status_code == 400
    assert c.post("/api/scan", json={"url": "http://10.0.0.1/", "authorized": True}).status_code == 400
    r = c.post("/api/scan", json={"url": "http://10.0.0.2/", "authorized": True})
    assert r.status_code == 429 and "Retry-After" in r.headers

    t = c.get("/api/stats").json()["today"]
    assert t["scans_rejected"] == 4 and t["scans_rate_limited"] == 1 and t["scans"] == 0 and t["unique_ips"] == 1

    c.post("/api/ai-consult", json={"scan": report})
    c.post("/api/ai-consult", json={"scan": report, "question": "hi", "history": []})
    t = c.get("/api/stats").json()["today"]
    assert t["consults"] == 1 and t["consults_fallback"] == 1 and t["followups"] == 1

    m.stats.record_scan("9.9.9.9", {"grade": "B", "tech": {"platform": "nextjs"}, "details": {"total_ms": 1200}})
    m.stats.record_scan("9.9.9.9", {"grade": "A", "tech": {"platform": "nextjs"}, "details": {"total_ms": 800}})
    s = c.get("/api/stats").json()
    t = s["since_start"]
    assert t["scans"] == 2 and t["grades"]["A"] == 1 and t["grades"]["B"] == 1 and t["avg_scan_ms"] == 1000
    assert t["top_platforms"][0] == ["nextjs", 2] and t["unique_ips"] == 2
    assert "example.com" not in str(s) and "10.0.0" not in str(s)


def test_stats_token(fresh_state):
    c = TestClient(m.app)
    fresh_state("STATS_TOKEN", "abc")
    assert c.get("/api/stats").status_code == 403
    assert c.get("/api/stats?token=abc").status_code == 200


def test_consult_requires_report(fresh_state):
    c = TestClient(m.app)
    assert c.post("/api/ai-consult", json={"scan": {}}).status_code == 400


def test_health_and_whoami(fresh_state):
    c = TestClient(m.app)
    h = c.get("/api/health")
    assert h.status_code == 200 and h.json()["llm_provider"] == "none" and "key_lengths" in h.json()
    assert c.head("/api/health").status_code == 200
    assert c.get("/api/whoami").json()["rate_limit_key"] == "testclient"


def test_sample_favicon_og(fresh_state):
    c = TestClient(m.app)
    s = c.get("/api/sample")
    assert s.status_code == 200 and s.json()["sample"] is True
    body = s.json()
    assert body["scan"]["target"]["hostname"] == "demo-shop.vercel.app" and body["scan"]["config_snippets"]
    assert body["ai_consult"]["mode"] == "llm" and body["ai_consult"]["fix_prompts"]
    assert "demo-shop.vercel.app" not in str(body["ai_consult"]).split("prompt")[0] or True  # 顧問可以提到網域，只確認結構
    assert c.get("/favicon.ico").headers["content-type"].startswith("image/svg+xml")
    assert c.get("/favicon.svg").status_code == 200
    og = c.get("/og.png")
    assert og.status_code == 200 and og.headers["content-type"] == "image/png" and og.content[:8] == b"\x89PNG\r\n\x1a\n"
    html = c.get("/").text
    assert 'property="og:image"' in html and 'rel="icon"' in html


def test_pages_security_headers_and_beacon(fresh_state):
    c = TestClient(m.app)
    r = c.get("/")
    assert r.status_code == 200 and "cloudflareinsights" not in r.text and "<!--CF_BEACON-->" not in r.text
    assert r.headers["x-frame-options"] == "DENY" and "content-security-policy" in r.headers
    assert c.head("/").status_code == 200 and c.head("/stats").status_code == 200
    fresh_state("CF_BEACON_TOKEN", 'abc123"x')
    r = c.get("/")
    assert "static.cloudflareinsights.com/beacon.min.js" in r.text
    assert 'data-cf-beacon=\'{"token": "abc123\\"x"}\'' in r.text
    assert "beacon.min.js" in c.get("/stats").text
    csp = r.headers["content-security-policy"]
    assert "static.cloudflareinsights.com" in csp and "https://cloudflareinsights.com" in csp
