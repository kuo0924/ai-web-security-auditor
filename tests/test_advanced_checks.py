"""進階檢查：混合內容、CSP 弱點、SRI、版本洩漏、過時函式庫、source map、service_role JWT、DNS 判斷。"""
import asyncio
import base64
import json
import time

import httpx

from conftest import fr, m


def test_mixed_content_only_active_on_https():
    html = ('<html><script src="http://cdn.a.com/x.js"></script><link rel="stylesheet" href="http://a.com/s.css">'
            '<link href="http://a.com/f.ico" rel="icon"><img src="http://a.com/i.png"><iframe src="http://x.com"></iframe></html>')
    assert len(m.mixed_content(html, "https")) == 3
    assert m.mixed_content(html, "http") == []


def test_csp_weaknesses():
    w = m.csp_weaknesses("default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self'")
    assert len(w) == 4
    assert m.csp_weaknesses("default-src 'none'; script-src 'self' 'nonce-abc' 'unsafe-inline'; base-uri 'self'") == []
    assert any("unsafe-inline" in x for x in m.csp_weaknesses("default-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'"))


def test_sri_flags_only_static_third_party_without_integrity():
    html = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/x/1.0/x.js"></script>'
            '<script src="https://www.googletagmanager.com/gtag/js"></script>'
            '<script src="https://cdn.jsdelivr.net/npm/y" integrity="sha384-abc" crossorigin="anonymous"></script>'
            '<script src="/app.js"></script>')
    assert m.scripts_without_sri(html, "https://site.example/") == ["https://cdnjs.cloudflare.com/ajax/libs/x/1.0/x.js"]


def test_version_disclosures():
    v = m.version_disclosures(httpx.Headers({"server": "nginx/1.18.0", "x-powered-by": "PHP/7.4.3"}), '<meta name="generator" content="WordPress 6.4.2">')
    assert len(v) == 3
    assert m.version_disclosures(httpx.Headers({"server": "nginx"}), "") == []


def test_outdated_libraries():
    libs = m.outdated_libraries([("a.js", "/*! jQuery v1.12.4 | (c) */"), ("b.html", '<script src="/js/jquery-3.7.1.min.js"></script> Bootstrap v3.3.7')])
    assert len(libs) == 2
    assert any("jQuery 1.12.4" in x for x in libs) and any("Bootstrap 3" in x for x in libs)


def test_sourcemap_reference_and_detection():
    assert m.sourcemap_reference("var a=1;\n//# sourceMappingURL=app.js.map", "https://s.example/static/app.js") == "https://s.example/static/app.js.map"
    assert m.sourcemap_reference("x\n//# sourceMappingURL=data:application/json;base64,e30=", "https://s.example/a.js") == "inline"
    assert m.sourcemap_reference("//# sourceMappingURL=https://other.example/a.map", "https://s.example/a.js") is None
    assert m.looks_like_sourcemap('{"version":3,"sources":["src/a.ts"],"mappings":"AAAA"}', "application/json")
    assert not m.looks_like_sourcemap("<html>", "text/html")


def _jwt(role):
    def b(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{b({'alg': 'HS256', 'typ': 'JWT'})}.{b({'iss': 'supabase', 'role': role, 'exp': 2000000000})}.{'x' * 43}"


def test_service_role_jwt_flagged_anon_not():
    f = m.scan_service_role_jwts([("app.js", f"const a='{_jwt('anon')}'; const s='{_jwt('service_role')}';")])
    assert len(f) == 1 and f[0]["type"] == "supabase_service_role"


def test_domain_helpers_and_email_check_skips():
    assert m.registrable_domain("www.shop.example.com.tw") == "example.com.tw"
    assert m.registrable_domain("api.example.com") == "example.com"
    assert m.hosted_platform_suffix("chaya-schedule-ocr.vercel.app") == "vercel.app"
    info = asyncio.run(m.email_dns_check(None, "x.onrender.com"))
    assert info["skipped"] and info["domain"] is None
    assert asyncio.run(m.email_dns_check(None, "1.2.3.4"))["skipped"]


def test_evaluate_with_advanced_inputs():
    html = b'<html><script src="/app.js"></script><script src="https://cdnjs.cloudflare.com/x.js"></script><script src="http://cdn.old.com/lib.js"></script></html>'
    main_r = fr(
        "https://adv.example/",
        headers={"content-type": "text/html", "server": "Apache/2.4.41", "strict-transport-security": "max-age=300",
                 "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'"},
        body=html, cookies=["sid=1; HttpOnly; Secure"], tls=time.time() + 5 * 86400,
    )
    rep = m.evaluate(
        input_url="https://adv.example/", main=main_r, http_probe=Exception("refused"),
        js_results=[("https://adv.example/app.js", fr("https://adv.example/app.js", body=b"/*! jQuery v2.2.4 */\n//# sourceMappingURL=app.js.map"))],
        env_result=fr("https://adv.example/.env", status=404), git_result=fr("https://adv.example/.git/config", status=404),
        env_variant_results=[
            ("/.env.local", fr("https://adv.example/.env.local", body=b"DB_PASS=x\n", headers={"content-type": "text/plain"})),
            ("/.env.production", fr("https://adv.example/.env.production", status=404)),
        ],
        sourcemap_results=[("https://adv.example/app.js", fr("https://adv.example/app.js.map", body=b'{"version":3,"sources":["src/a.ts"],"mappings":"AAAA"}', headers={"content-type": "application/json"}))],
        security_txt_result=fr("https://adv.example/.well-known/security.txt", status=404),
        dns_info={"domain": "adv.example", "spf": True, "dmarc": False, "skipped": None},
    )
    ids = {i["id"] for i in rep["issues"]}
    for want in ("mixed_content", "sourcemap_exposed", "env_exposed", "hsts_weak", "csp_weak", "server_version", "sri_missing",
                 "outdated_library", "tls_expiring", "security_txt", "email_spoofing", "cookie_samesite", "cross_origin_isolation"):
        assert want in ids, want
    pen = {i["id"]: i["penalty"] for i in rep["issues"]}
    assert pen["env_exposed"] == 30 and pen["mixed_content"] == 10 and pen["sourcemap_exposed"] == 5
    assert all(pen[k] == 0 for k in ("hsts_weak", "csp_weak", "server_version", "sri_missing", "outdated_library", "tls_expiring", "security_txt", "email_spoofing", "cookie_samesite", "cross_origin_isolation"))
    assert "/.env.local" in next(i for i in rep["issues"] if i["id"] == "env_exposed")["evidence"]
    em = next(i for i in rep["issues"] if i["id"] == "email_spoofing")["evidence"]
    assert "DMARC" in em and "SPF" not in em
    assert rep["score"] == 30
    assert "Vite" in next(i for i in rep["issues"] if i["id"] == "sourcemap_exposed")["fix_prompt"]


def test_tls_far_from_expiry_passes():
    rep = m.evaluate(input_url="https://a.example/", main=fr("https://a.example/", headers={"content-type": "text/html"}, tls=time.time() + 90 * 86400),
                     http_probe=None, js_results=[], env_result=fr("x", status=404), git_result=fr("x", status=404))
    assert any(p["id"] == "tls_cert" for p in rep["passed"])
