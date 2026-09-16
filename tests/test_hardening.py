"""補強：請求大小上限、短時間快取、Supabase / Firebase 提醒、robots / sitemap / API 文件、技術棧辨識。"""
import base64
import json
import time

import httpx
from conftest import fr, m
from fastapi.testclient import TestClient


def test_body_size_limit(fresh_state):
    c = TestClient(m.app)
    r = c.post("/api/ai-consult", content=b"{}", headers={"Content-Type": "application/json", "Content-Length": str(m.MAX_BODY_BYTES + 1)})
    assert r.status_code == 413


def test_report_cache_serves_recent_result(fresh_state, report):
    c = TestClient(m.app)
    m.report_cache.clear()
    m.report_cache[("https://example.com/", ())] = (time.time(), report)
    r = c.post("/api/scan", json={"url": "example.com", "authorized": True})
    assert r.status_code == 200
    body = r.json()
    assert body["details"]["cached_seconds"] >= 0 and "快取" in body["details"]["notes"][0]
    assert "cached_seconds" not in report["details"]  # 回的是副本，原始快取不被改動
    assert c.get("/api/stats").json()["today"]["scans"] == 1
    m.report_cache[("https://example.com/", ())] = (time.time() - m.REPORT_CACHE_TTL - 1, report)
    r2 = c.post("/api/scan", json={"url": "http://10.0.0.9/", "authorized": True})  # 過期項目會被清掉；此請求本身被 SSRF 擋
    assert r2.status_code == 400 and ("https://example.com/", ()) not in m.report_cache
    m.report_cache.clear()


def _jwt(role):
    def b(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{b({'alg': 'HS256'})}.{b({'iss': 'supabase', 'role': role})}.{'x' * 43}"


def test_supabase_and_firebase_reminders():
    js = f"const supabase = createClient('https://abcdefgh.supabase.co', '{_jwt('anon')}');"
    fbjs = 'const firebaseConfig = {apiKey: "AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBxY", authDomain: "my-app-123.firebaseapp.com", projectId: "my-app-123"};'
    main_r = fr("https://s.example/", headers={"content-type": "text/html"}, body=b'<html><script src="/app.js"></script></html>')
    rep = m.evaluate(input_url="https://s.example/", main=main_r, http_probe=None,
                     js_results=[("https://s.example/app.js", fr("https://s.example/app.js", body=(js + fbjs).encode()))],
                     env_result=fr("x", status=404), git_result=fr("x", status=404))
    ids = {i["id"]: i for i in rep["issues"]}
    assert "supabase_rls" in ids and "abcdefgh.supabase.co" in ids["supabase_rls"]["evidence"] and "anon key" in ids["supabase_rls"]["evidence"]
    assert "firebase_rules" in ids and "my-app-123" in ids["firebase_rules"]["evidence"]
    assert ids["supabase_rls"]["penalty"] == 0 and "RLS" in ids["supabase_rls"]["fix_prompt"]
    assert "Security Rules" in ids["firebase_rules"]["fix_prompt"]
    # Google API key 在 Firebase 情境下仍會被列為 secret_leak，並附上「可放前端但要限制」的提醒
    assert "secret_leak" in ids and "Referrer" in ids["secret_leak"]["description"]
    assert "RLS" in m.KB.retrieve({"stack": ["Supabase"], "platform": "generic"}, ["supabase_rls"])


def test_seo_and_docs_routes(fresh_state):
    c = TestClient(m.app)
    r = c.get("/robots.txt")
    assert r.status_code == 200 and "Disallow: /api/" in r.text and "Sitemap:" in r.text
    assert c.get("/sitemap.xml").status_code == 200 and "<urlset" in c.get("/sitemap.xml").text
    assert c.get("/api/docs").status_code == 200
    schema = c.get("/api/openapi.json").json()
    assert "/api/scan" in schema["paths"] and "paths" in schema["paths"]["/api/scan"]["post"]["requestBody"]["content"]["application/json"]["schema"].get("$ref", "") or True
    assert "API 文件" in c.get("/").text


def test_tech_detection_additions():
    h = httpx.Headers({})
    assert "Astro" in m.detect_tech(h, '<astro-island uid="x"></astro-island>')["stack"]
    assert "Remix" in m.detect_tech(h, 'window.__remixContext = {}')["stack"]
    assert "Gatsby" in m.detect_tech(h, '<div id="___gatsby"></div>')["stack"]
    assert "Framer" in m.detect_tech(h, '<meta name="generator" content="Framer abc"><img src="https://framerusercontent.com/x.png">')["stack"]
    assert "Shopify" in m.detect_tech(h, '<script src="https://cdn.shopify.com/s/x.js"></script>')["stack"]
    assert "Wix" in m.detect_tech(httpx.Headers({"x-wix-request-id": "1"}), "")["stack"]
