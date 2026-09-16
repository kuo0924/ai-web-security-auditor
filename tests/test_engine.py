"""硬規則檢測層：SSRF 判定、金鑰正則、檔案裸露辨識、計分。完全離線。"""
import asyncio
import ipaddress

import pytest
from conftest import fr, m


@pytest.mark.parametrize("ip,expected", [
    ("127.0.0.1", False), ("10.0.0.1", False), ("172.16.5.5", False), ("192.168.1.1", False),
    ("169.254.169.254", False), ("0.0.0.0", False), ("100.64.0.1", False), ("::1", False),
    ("::ffff:127.0.0.1", False), ("fe80::1", False), ("fc00::1", False), ("224.0.0.1", False),
    ("8.8.8.8", True), ("93.184.216.34", True), ("2606:4700::1111", True),
])
def test_ip_is_public(ip, expected):
    assert m._ip_is_public(ipaddress.ip_address(ip)) is expected


@pytest.mark.parametrize("host", [
    "localhost", "127.0.0.1", "[::1]", "10.0.0.1", "169.254.169.254", "metadata.google.internal",
    "printer.local", "db.internal", "foo.localhost", "::ffff:10.0.0.1",
])
def test_resolve_blocks_internal_hosts(host):
    with pytest.raises(m.SSRFBlocked):
        asyncio.run(m.resolve_public_ip(host, 80))


def test_resolve_unknown_domain_is_unreachable():
    with pytest.raises(m.TargetUnreachable):
        asyncio.run(m.resolve_public_ip("this-domain-does-not-exist-xyz123.invalid", 80))


def test_decimal_ip_obfuscation_never_reaches_private():
    try:
        ip = asyncio.run(m.resolve_public_ip("2130706433", 80))
    except (m.SSRFBlocked, m.TargetUnreachable):
        return
    assert m._ip_is_public(ipaddress.ip_address(ip))


def test_normalize_target():
    assert m.normalize_target("example.com") == "https://example.com/"
    assert m.normalize_target("http://a.b/c?d=1#x") == "http://a.b/c?d=1"
    for bad in ["", "ftp://x.com", "https://user:pw@x.com", "https://", "javascript:alert(1)", "https://x.com:99999"]:
        with pytest.raises(ValueError):
            m.normalize_target(bad)


SAMPLE_JS = """
const a = "sk-" + "abc";  // 不該命中
.sk-chasing-dots-2-child { }  // CSS 假陽性
const openai = "sk-Ab3dEf7GhIjKlMnOpQrStUvWxYz0123456789AbCd";
const google = "AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBxY";
const stripe = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";
const aws = "AKIAIOSFODNN7EXAMPLE";
const gh = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
"""


def test_secret_patterns():
    found = m.scan_secrets([("test.js", SAMPLE_JS)])
    assert sorted(f["type"] for f in found) == ["aws", "github", "google", "openai", "stripe"]
    assert all("…" in f["masked"] and len(f["masked"]) < 40 for f in found)
    assert not any("chasing" in f["masked"] for f in found)
    assert m.scan_secrets([("x", "<html><script>var k='sk-';</script></html>")]) == []


def test_env_and_git_detection_ignores_spa_fallback():
    assert not m.looks_like_env("<!doctype html><html>...</html>", "text/html")
    assert m.looks_like_env("DB_PASSWORD=hunter2\nAPI_KEY=abc", "text/plain")
    assert m.looks_like_git_config("[core]\n\trepositoryformatversion = 0", "text/plain")
    assert not m.looks_like_git_config("<html>[core]</html>", "text/html")


BAD_HTML = b"""<html><head><script src="/app.js"></script><script src="https://cdn.x.com/lib.js"></script></head>
<body><div id="__next"></div><script>const k="sk-Ab3dEf7GhIjKlMnOpQrStUvWxYz0123456789AbCd";</script></body></html>"""


def test_evaluate_bad_site_flags_everything():
    main_r = fr("http://bad.example/", headers={"content-type": "text/html", "x-powered-by": "Next.js", "server": "nginx"},
                body=BAD_HTML, cookies=["session=abc; Path=/", "theme=dark; Secure"])
    report = m.evaluate(
        input_url="http://bad.example/", main=main_r, http_probe=None,
        js_results=[("http://bad.example/app.js", fr("http://bad.example/app.js", body=b"var x = 'AKIAIOSFODNN7EXAMPLE';"))],
        env_result=fr("http://bad.example/.env", body=b"SECRET=1\n", headers={"content-type": "text/plain"}),
        git_result=fr("http://bad.example/.git/config", body=b"[core]\n", headers={"content-type": "text/plain"}),
    )
    ids = {i["id"] for i in report["issues"]}
    assert ids == {
        "https", "hsts", "x_frame_options", "csp", "x_content_type_options", "cookie_httponly", "cookie_secure",
        "secret_leak", "env_exposed", "git_exposed", "referrer_policy", "permissions_policy",
        "cross_origin_isolation", "cookie_samesite", "sri_missing",
    }
    assert report["score"] == 0 and report["grade"] == "F"
    assert report["tech"] == {"stack": ["Next.js", "Nginx"], "platform": "nextjs"}
    assert report["details"]["js_files_scanned"] == ["http://bad.example/app.js"]
    leak = next(i for i in report["issues"] if i["id"] == "secret_leak")
    assert len(leak["findings"]) == 2
    assert "next.config" in next(i for i in report["issues"] if i["id"] == "csp")["fix_prompt"]
    assert [i["severity"] for i in report["issues"]][:3] == ["critical"] * 3


GOOD_HEADERS = {
    "content-type": "text/html; charset=utf-8",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "content-security-policy": "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "cross-origin-opener-policy": "same-origin",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": "camera=()",
    "x-vercel-id": "abc",
}


def test_evaluate_good_site_is_clean():
    main_r = fr("https://good.example/", headers=GOOD_HEADERS, body=b"<html><body>hi</body></html>",
                cookies=["s=1; HttpOnly; Secure; SameSite=Lax"])
    probe = fr("https://good.example/", hops=[{"from": "http://good.example/", "to": "https://good.example/", "status": 301}])
    report = m.evaluate(
        input_url="https://good.example/", main=main_r, http_probe=probe, js_results=[],
        env_result=fr("https://good.example/.env", status=404),
        git_result=fr("https://good.example/.git/config", status=200, body=b"<!doctype html><html>spa</html>", headers={"content-type": "text/html"}),
    )
    assert report["score"] == 100 and report["grade"] == "A"
    assert report["issues"] == []
    assert any("frame-ancestors" in p["detail"] for p in report["passed"] if p["id"] == "x_frame_options")
    assert any("fallback" in p["detail"] for p in report["passed"] if p["id"] == "git_exposed")
    assert "Vercel" in report["tech"]["stack"]


def test_config_snippets_follow_platform():
    issues = [{"id": "csp"}, {"id": "hsts"}, {"id": "x_content_type_options"}, {"id": "https"}, {"id": "env_exposed"}]
    nx = m.build_config_snippets(issues, {"platform": "nextjs"})
    assert nx[0]["filename"] == "next.config.js" and "Strict-Transport-Security" in nx[0]["content"] and "Content-Security-Policy-Report-Only" in nx[0]["content"]
    assert "X-Frame-Options" not in nx[0]["content"]  # 沒缺的不列
    assert nx[-1]["filename"] == "headers.txt"
    ng = m.build_config_snippets(issues, {"platform": "nginx"})
    assert "add_header" in ng[0]["content"] and "return 301" in ng[0]["content"] and "deny all" in ng[0]["content"]
    ap = m.build_config_snippets(issues, {"platform": "apache"})
    assert "Header always set" in ap[0]["content"] and "RewriteCond %{HTTPS} off" in ap[0]["content"]
    vc = m.build_config_snippets([{"id": "x_frame_options"}], {"platform": "vercel"})
    assert vc[0]["filename"] == "vercel.json" and '"X-Frame-Options"' in vc[0]["content"]
    assert m.build_config_snippets([{"id": "referrer_policy"}], {"platform": "netlify"})[0]["filename"] == "public/_headers"
    assert "hooks.server.ts" in m.build_config_snippets([{"id": "csp"}], {"platform": "sveltekit"})[0]["filename"]
    assert "routeRules" in m.build_config_snippets([{"id": "csp"}], {"platform": "nuxt"})[0]["content"]
    assert "res.setHeader" in m.build_config_snippets([{"id": "csp"}], {"platform": "express"})[0]["content"]
    assert "<meta" in m.build_config_snippets([{"id": "csp"}], {"platform": "github-pages"})[0]["content"]
    assert m.build_config_snippets([{"id": "secret_leak"}], {"platform": "nextjs"}) == []
    assert m.build_config_snippets([{"id": "csp_weak"}], {"platform": "generic"})[0]["content"].count("Content-Security-Policy-Report-Only") == 1


def test_grade_boundaries():
    assert [m.grade_for(s)[0] for s in (100, 85, 84, 70, 69, 50, 49, 0)] == ["A", "A", "B", "B", "C", "C", "F", "F"]


def test_sliding_window_limiter():
    lim = m.SlidingWindowLimiter(3, 60)
    assert [lim.hit("1.2.3.4")[0] for _ in range(4)] == [True, True, True, False]
    assert lim.hit("5.6.7.8")[0]


def test_fallback_consult_and_knowledge_base(report):
    fb = m.fallback_consult(report, m.scan_digest(report), "no key")
    assert fb["mode"] == "fallback" and len(fb["fix_prompts"]) == 5
    digest = m.scan_digest(report)
    assert all(len(i["evidence"]) <= 240 for i in digest["issues"])
    assert all(isinstance(p, dict) and "detail" in p for p in digest["passed"])
    assert "next.config" in m.KB.retrieve({"stack": ["Next.js"], "platform": "nextjs"}, ["csp"])
    assert "unsafe-inline" in m.KB.retrieve({"stack": ["Next.js", "Vercel"], "platform": "nextjs"}, [])
    assert len(m.KB.fewshot) == 1
    assert "unsafe-inline" in m.SYSTEM_PROMPT
