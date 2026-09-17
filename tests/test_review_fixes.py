"""多代理審查（2026-09-17）確認的四個問題的回歸測試：
1. sitemap <loc> 正則的 O(n²) 回溯（惡意 sitemap 可卡死事件迴圈）
2. sitemap / robots.txt 裡的壞網址讓 urlparse 丟 ValueError → 整個掃描變 500
3. AI Prompt 的回饋 id 超過 80 字元被 422，而瀏覽器已先鎖定
4. index.html 加了新 class 卻沒重建 static/tailwind.css
"""
import asyncio
import json
import pathlib
import re
import time

from conftest import fr, m, patch_all
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORIGIN = "https://site.example"


def _fake_fetch(table):
    async def fake(client, url, **kw):
        r = table.get(url)
        return r if r is not None else fr(url, status=404)
    return fake


def test_sitemap_loc_regex_is_linear_on_hostile_input():
    hostile = [
        "<loc>" + " " * 300_000,
        "<loc>a" + " " * 300_000,
        "<loc><![CDATA[" + " " * 300_000,
        "<loc>a" + " " * 150_000 + "]]>" + " " * 150_000,
        "<sitemapindex>" + "<loc>\n" * 60_000,
    ]
    t0 = time.perf_counter()
    for body in hostile:
        assert m.sitemap_locs(body)[0] == []
    assert time.perf_counter() - t0 < 2.0  # 修正前單一輸入就要數百秒
    # 行為不變：純文字、CDATA、前後有空白與換行都照樣抓得到
    xml = "<urlset><url><loc>https://a.example/x</loc></url><url><loc>\n  <![CDATA[ https://a.example/y ]]>\n </loc></url><url><loc> https://a.example/z?a=1&amp;b=2 </loc></url></urlset>"
    assert m.sitemap_locs(xml) == (["https://a.example/x", "https://a.example/y", "https://a.example/z?a=1&b=2"], False)


def test_malformed_urls_in_sitemap_and_robots_are_skipped(monkeypatch):
    assert m.pick_sitemap_paths(["https://[site.example/x", "http://[::1/", "https://site.example/login"], ORIGIN, [], 5) == ["/login"]

    urlset = "<urlset><url><loc>https://[site.example/x</loc></url><url><loc>https://site.example/login</loc></url></urlset>"
    patch_all(monkeypatch, "safe_fetch", _fake_fetch({ORIGIN + "/sitemap.xml": fr(ORIGIN + "/sitemap.xml", body=urlset.encode())}))
    assert asyncio.run(m.discover_paths(None, ORIGIN, [], 5))[0] == ["/login"]

    patch_all(monkeypatch, "safe_fetch", _fake_fetch({ORIGIN + "/robots.txt": fr(ORIGIN + "/robots.txt", body=b"Sitemap: https://[bad\n")}))
    paths, note, _ = asyncio.run(m.discover_paths(None, ORIGIN, [], 5))
    assert paths == [] and "沒有 /sitemap.xml" in note

    index = "<sitemapindex><sitemap><loc>https://[bad</loc></sitemap></sitemapindex>"
    patch_all(monkeypatch, "safe_fetch", _fake_fetch({ORIGIN + "/sitemap.xml": fr(ORIGIN + "/sitemap.xml", body=index.encode())}))
    assert asyncio.run(m.discover_paths(None, ORIGIN, [], 5))[0] == []


def test_auto_discovery_failure_never_breaks_the_scan(monkeypatch):
    home = fr(ORIGIN + "/", headers={"content-type": "text/html"}, body=b"<html>home</html>")
    patch_all(monkeypatch, "safe_fetch", _fake_fetch({ORIGIN + "/": home}))

    async def no_dns(client, host):
        return None

    async def boom(*a, **kw):
        raise RuntimeError("unexpected parser bug")
    patch_all(monkeypatch, "email_dns_check", no_dns)
    patch_all(monkeypatch, "discover_paths", boom)
    rep = asyncio.run(m.run_scan(ORIGIN + "/", [], auto_paths=True))
    assert rep["details"]["auto_paths"] == [] and any("無法解析" in n for n in rep["details"]["notes"]) and "score" in rep


def test_feedback_accepts_merged_ai_prompt_ids(fresh_state):
    c = TestClient(m.app)
    merged = "+".join(["csp", "x_frame_options", "x_content_type_options", "referrer_policy", "permissions_policy", "cross_origin_isolation"])
    assert len(merged) > 80
    r = c.post("/api/feedback", json={"kind": "ai", "issue_id": merged, "vote": "up"})
    assert r.status_code == 200 and r.json()["up"] == 1
    everything = "+".join(m.ISSUE_CATALOG)
    assert len(everything) <= 400 and c.post("/api/feedback", json={"kind": "ai", "issue_id": everything, "vote": "down"}).status_code == 200
    assert c.post("/api/feedback", json={"kind": "ai", "issue_id": "a" * 401, "vote": "up"}).status_code == 422


def test_vote_handler_locks_only_after_server_accepts():
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    handler = js[js.index("closest('[data-vote]')"):]
    handler = handler[:handler.index("renderHistory();")]
    sample, post, store = handler.index("state.mode === 'sample'"), handler.index("fetch('/api/feedback'"), handler.index("localStorage.setItem")
    assert sample < post < store, "範例模式要先擋、localStorage 要在伺服器收下之後才寫"
    assert "if (!ok)" in handler and "b.disabled = false" in handler
    assert "(fp.issue_ids || []).length ? fp.issue_ids" in js  # 空陣列要退回 issue_id / general


def test_built_css_contains_layout_utilities_used_by_pages():
    """static/tailwind.css 是進版控的建置產物，Render 不跑 Node；頁面加了新的版面 class 卻沒 npm run css，線上就會跑版。"""
    css = (ROOT / "static" / "tailwind.css").read_text(encoding="utf-8")
    layout = re.compile(r"^(?:(?:sm|md|lg):)?(?:grid-cols-\d+|col-span-\d+|gap(?:-[xy])?-[\d.]+|space-[xy]-[\d.]+|[pm][xytblr]?-[\d.]+|[wh]-[\d.]+|self-\w+|max-w-\w+)$")
    missing = set()
    for page in ("index.html", "stats.html"):
        html = (ROOT / page).read_text(encoding="utf-8")
        for attr in re.findall(r'class="([^"]+)"', html):
            for token in attr.split():
                if layout.match(token) and "." + token.replace(":", "\\:").replace(".", "\\.") not in css:
                    missing.add(f"{page}: {token}")
    assert not missing, f"static/tailwind.css 缺少這些 class，請執行 npm run css：{sorted(missing)}"
    assert json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]["css"].startswith("tailwindcss")
