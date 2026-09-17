"""sitemap 自動找頁：挑路徑的規則、sitemap index 與 robots.txt 備援、失敗不影響主掃描、API 參數與快取鍵。"""
import asyncio
import json

from conftest import fr, m, patch_all
from fastapi.testclient import TestClient

ORIGIN = "https://site.example"
URLSET = """<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://www.site.example/</loc></url>
<url><loc>https://www.site.example/about</loc></url>
<url><loc>https://site.example/blog/post-1?x=1</loc></url>
<url><loc><![CDATA[https://site.example/dashboard]]></loc></url>
<url><loc>https://site.example/login</loc></url>
<url><loc>https://other.example/login</loc></url>
<url><loc>https://site.example/image.png</loc></url>
<url><loc>https://site.example/pricing&amp;plan</loc></url>
<url><loc>https://site.example/account/settings</loc></url>
</urlset>"""


def _fake_fetch(table):
    async def fake(client, url, **kw):
        r = table.get(url)
        if r is None:
            return fr(url, status=404)
        if isinstance(r, Exception):
            raise r
        return r
    return fake


def test_pick_sitemap_paths_priority_and_filters():
    locs, is_index = m.sitemap_locs(URLSET)
    assert not is_index and len(locs) == 9 and "https://site.example/pricing&plan" in locs
    picked = m.pick_sitemap_paths(locs, ORIGIN, exclude=["/about"], limit=5)
    assert picked == ["/login", "/account/settings", "/dashboard", "/pricing&plan", "/blog/post-1"]
    assert m.pick_sitemap_paths(locs, ORIGIN, exclude=[], limit=0) == []
    assert m.pick_sitemap_paths(locs, "https://elsewhere.example", exclude=[], limit=5) == []


def test_discover_paths_index_robots_and_failures(monkeypatch):
    index = f"<sitemapindex><sitemap><loc>{ORIGIN}/sm-a.xml</loc></sitemap><sitemap><loc>https://cdn.other/sm.xml</loc></sitemap></sitemapindex>"
    patch_all(monkeypatch, "safe_fetch", _fake_fetch({ORIGIN + "/sitemap.xml": fr(ORIGIN + "/sitemap.xml", body=index.encode()), ORIGIN + "/sm-a.xml": fr(ORIGIN + "/sm-a.xml", body=URLSET.encode())}))
    paths, note, n = asyncio.run(m.discover_paths(None, ORIGIN, ["/login"], 3))
    assert paths == ["/account/settings", "/dashboard", "/about"] and "sitemap index" in note and n == 2

    robots = f"User-agent: *\nSitemap: https://evil.example/s.xml\nSitemap: {ORIGIN}/maps/s.xml.gz\nSitemap: {ORIGIN}/maps/s.xml\n"
    patch_all(monkeypatch, "safe_fetch", _fake_fetch({ORIGIN + "/robots.txt": fr(ORIGIN + "/robots.txt", body=robots.encode()), ORIGIN + "/maps/s.xml": fr(ORIGIN + "/maps/s.xml", body=URLSET.encode())}))
    paths, note, n = asyncio.run(m.discover_paths(None, ORIGIN, [], 5))
    assert paths[0] == "/login" and "/maps/s.xml" in note and n == 3

    patch_all(monkeypatch, "safe_fetch", _fake_fetch({}))
    paths, note, n = asyncio.run(m.discover_paths(None, ORIGIN, [], 5))
    assert paths == [] and "沒有 /sitemap.xml" in note and n == 2

    patch_all(monkeypatch, "safe_fetch", _fake_fetch({ORIGIN + "/sitemap.xml": m.SSRFBlocked("blocked")}))
    assert asyncio.run(m.discover_paths(None, ORIGIN, [], 5))[0] == []
    assert asyncio.run(m.discover_paths(None, ORIGIN, ["/a", "/b", "/c", "/d", "/e"], 0)) == ([], "自動找頁：手動路徑已達上限，未再加頁", 0)


def test_run_scan_merges_auto_paths(monkeypatch):
    home = fr(ORIGIN + "/", headers={"content-type": "text/html", "strict-transport-security": "max-age=31536000"}, body=b"<html>home</html>")
    login = fr(ORIGIN + "/login", headers={"content-type": "text/html"}, body=b"<html>login</html>", cookies=["session=abc; Path=/"])
    table = {ORIGIN + "/": home, ORIGIN + "/sitemap.xml": fr(ORIGIN + "/sitemap.xml", body=URLSET.encode()), ORIGIN + "/login": login}
    patch_all(monkeypatch, "safe_fetch", _fake_fetch(table))

    async def no_dns(client, host):
        return None
    patch_all(monkeypatch, "email_dns_check", no_dns)
    rep = asyncio.run(m.run_scan(ORIGIN + "/", ["/about"], auto_paths=True))
    assert rep["details"]["auto_paths"] == ["/login", "/account/settings", "/dashboard", "/pricing&plan"]
    assert [p["path"] for p in rep["details"]["extra_pages"]][:2] == ["/about", "/login"]
    assert any(n.startswith("自動找頁：從 /sitemap.xml") for n in rep["details"]["notes"])
    assert "cookie_httponly" in {i["id"] for i in rep["issues"]}  # /login 的 Cookie 被合併進報告
    rep2 = asyncio.run(m.run_scan(ORIGIN + "/", ["/about"]))
    assert "auto_paths" not in rep2["details"] and rep2["details"]["requests_made"] < rep["details"]["requests_made"]


def test_api_auto_paths_and_cache_key(fresh_state, monkeypatch, report):
    calls = []

    async def fake_run_scan(url, paths, auto_paths=False):
        calls.append((url, paths, auto_paths))
        return json.loads(json.dumps(report))
    patch_all(monkeypatch, "run_scan", fake_run_scan)
    c = TestClient(m.app)
    m.report_cache.clear()
    r = c.post("/api/scan", json={"url": "https://example.com/", "authorized": True, "auto_paths": True})
    assert r.status_code == 200 and calls[-1] == ("https://example.com/", [], True)
    r2 = c.post("/api/scan", json={"url": "https://example.com/", "authorized": True})
    assert r2.status_code == 200 and "cached_seconds" not in r2.json()["details"] and calls[-1][2] is False
    assert "cached_seconds" in c.post("/api/scan", json={"url": "https://example.com/", "authorized": True, "auto_paths": True}).json()["details"]
    m.report_cache.clear()
    html = c.get("/").text
    assert 'id="auto-paths"' in html and "auto_paths" in c.get("/static/app.js").text
