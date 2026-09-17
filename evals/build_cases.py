"""用 evaluate() 從合成的抓取結果產出評測案例，不碰網路。

執行：python evals/build_cases.py
輸出：evals/cases/<name>.json，每個檔案 = {"name", "description", "scan": 體檢報告, "expect": 期望}
規則引擎改了（新增檢查、改扣分）就重跑一次，讓案例裡的報告跟現行規則一致。
"""
from __future__ import annotations

import base64
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402

from scanner import FetchResult, evaluate  # noqa: E402

CASES_DIR = ROOT / "evals" / "cases"


def fr(url: str, status: int = 200, headers: dict | None = None, body: bytes = b"", cookies: list[str] | None = None, hops: list[dict] | None = None) -> FetchResult:
    return FetchResult(url=url, status=status, headers=httpx.Headers(headers or {}), body=body, set_cookies=cookies or [], hops=hops or [])


def _jwt(role: str) -> str:
    def b(d: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{b({'alg': 'HS256', 'typ': 'JWT'})}.{b({'iss': 'supabase', 'ref': 'abcdefghijkl', 'role': role, 'iat': 1700000000, 'exp': 2000000000})}.{'Qx7' * 15}"


def build(url: str, headers: dict, html: str, js: str | None = None, cookies: list[str] | None = None,
          http_redirects: bool = True, env_body: bytes | None = None) -> dict:
    main = fr(url, headers={"content-type": "text/html; charset=utf-8", **headers}, body=html.encode(), cookies=cookies)
    host = url.split("//", 1)[1].split("/", 1)[0]
    probe = None
    if url.startswith("https://"):
        # safe_fetch 會跟著轉址，所以「有轉址」的探測結果是：最終 URL 為 https、hops 記錄那一跳
        probe = (fr(url, status=200, headers={"content-type": "text/html"}, body=b"<html>ok</html>", hops=[{"from": f"http://{host}/", "to": url, "status": 308}])
                 if http_redirects else fr(f"http://{host}/", status=200, headers={"content-type": "text/html"}, body=b"<html>ok</html>"))
    js_results: list[tuple[str, FetchResult | Exception]] = (
        [(f"{url.rstrip('/')}/app.js", fr(f"{url.rstrip('/')}/app.js", headers={"content-type": "application/javascript"}, body=js.encode()))] if js is not None else []
    )
    env = fr(f"{url.rstrip('/')}/.env", status=200, headers={"content-type": "text/plain"}, body=env_body) if env_body else fr(f"{url.rstrip('/')}/.env", status=404)
    report = evaluate(input_url=url, main=main, http_probe=probe, js_results=js_results, env_result=env,
                      git_result=fr(f"{url.rstrip('/')}/.git/config", status=404))
    report["details"]["engine_ms"] = 0  # 計時每次不同；固定成 0，案例才可重現、可比對（也不放 scanned_at）
    return json.loads(json.dumps(report, ensure_ascii=False))  # 先走一次 JSON，型別與存檔後一致


GOOD_HEADERS = {
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "content-security-policy": "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
}

CASES: list[dict] = [
    {
        "name": "nextjs-vercel-missing-headers",
        "description": "Next.js on Vercel：HTTPS 與 HSTS 齊，缺 CSP、X-Frame-Options、nosniff、Referrer-Policy。顧問應指向 next.config.js 的 headers()。",
        "scan": lambda: build(
            "https://my-saas.vercel.app/",
            {"server": "Vercel", "x-vercel-id": "sfo1::abcd-1700000000000-0123456789ab", "strict-transport-security": "max-age=63072000; includeSubDomains"},
            '<!doctype html><html><head><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script></head>'
            '<body><div id="__next"></div><script src="/_next/static/chunks/main-app.js"></script></body></html>',
            js="(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[1],{}]);",
        ),
        "expect": {
            "risk_level_in": ["中", "高"],
            "must_mention_any": [["next.config", "vercel.json", "headers()"]],
            "must_not_mention": ["nginx", ".htaccess", "apache"],
            "fix_prompts_cover": ["csp", "x_frame_options"],
        },
    },
    {
        "name": "lovable-supabase-openai-key-leak",
        "description": "Lovable 產的前端，JS 裡有 OpenAI 金鑰與 Supabase anon key。顧問第一步必須是撤銷金鑰，並提醒 RLS。",
        "scan": lambda: build(
            "https://my-crm.lovable.app/",
            {"server": "cloudflare", "cf-ray": "8a1b2c3d4e5f-TPE", "strict-transport-security": "max-age=31536000"},
            '<!doctype html><html><head><meta property="og:url" content="https://my-crm.lovable.app/"><script type="module" src="/app.js"></script></head><body><div id="root"></div></body></html>',
            js=(
                f'import{{createClient}}from"@supabase/supabase-js";const supabase=createClient("https://abcdefghijkl.supabase.co","{_jwt("anon")}");'
                'const OPENAI_KEY="sk-proj-k3Jd9Xw2Qp7Lm4Nz8Rt5Vb1Yc6Hs0Fa2Ge9Ui4Ok7Pl3Wq";'
                'export async function ask(q){return fetch("https://api.openai.com/v1/chat/completions",{headers:{Authorization:"Bearer "+OPENAI_KEY}})}'
            ),
        ),
        "expect": {
            "risk_level_in": ["危急"],
            "must_mention_any": [["撤銷", "輪換", "重新產生", "作廢", "revoke", "rotate"], ["RLS", "Row Level"]],
            "must_not_mention": ["nginx", ".htaccess"],
            "fix_prompts_cover": ["secret_leak"],
        },
    },
    {
        "name": "netlify-static-env-exposed",
        "description": "Netlify 靜態站把 .env 一起部署出去。顧問要把「刪掉並輪換裡面的密碼」排第一，設定檔應是 _headers / netlify.toml。",
        "scan": lambda: build(
            "https://landing.netlify.app/",
            {"server": "Netlify", "x-nf-request-id": "01HZX0000000000000000000", "strict-transport-security": "max-age=31536000"},
            "<!doctype html><html><head><title>Landing</title></head><body><h1>Hi</h1><script src=\"/app.js\"></script></body></html>",
            js="document.querySelector('h1').textContent='Hello';",
            env_body=b"DATABASE_URL=postgres://app:Sup3rS3cret@db.internal:5432/app\nMAIL_PASSWORD=hunter2hunter2\nNEXT_PUBLIC_SITE=https://landing.netlify.app\n",
        ),
        "expect": {
            "risk_level_in": ["危急"],
            "must_mention_any": [[".env"], ["_headers", "netlify.toml", "刪除", "移除", "排除"]],
            "must_not_mention": ["next.config"],
            "fix_prompts_cover": ["env_exposed"],
        },
    },
    {
        "name": "self-hosted-nginx-plain-http",
        "description": "自架 nginx + Express，整站 HTTP、Cookie 沒 HttpOnly/Secure。顧問應先講 HTTPS（certbot / Let's Encrypt），設定檔是 nginx。",
        "scan": lambda: build(
            "http://shop.example.tw/",
            {"server": "nginx/1.24.0", "x-powered-by": "Express"},
            "<!doctype html><html><head><title>Shop</title></head><body><form action=\"/login\" method=\"post\"></form><script src=\"/app.js\"></script></body></html>",
            js="console.log('shop');",
            cookies=["connect.sid=s%3Aabc.def; Path=/", "cart=1; Path=/"],
        ),
        "expect": {
            "risk_level_in": ["高", "危急"],
            "must_mention_any": [["nginx", "certbot", "let's encrypt", "letsencrypt"], ["https"]],
            "must_not_mention": ["next.config", "vercel.json"],
            "fix_prompts_cover": ["https", "cookie_httponly"],
        },
    },
    {
        "name": "clean-site-a-grade",
        "description": "全部及格的網站。顧問不該無中生有，風險應為低，優先行動最多 4 條。",
        "scan": lambda: build(
            "https://docs.example.com/",
            {"server": "cloudflare", "cf-ray": "8a1b2c3d4e5f-TPE", **GOOD_HEADERS},
            "<!doctype html><html><head><title>Docs</title></head><body><main>Hello</main><script src=\"/app.js\"></script></body></html>",
            js="console.log('docs');",
            cookies=["session=abc; Path=/; HttpOnly; Secure; SameSite=Lax"],
        ),
        "expect": {
            "risk_level_in": ["低"],
            "max_priority_actions": 4,
            "must_not_mention": ["撤銷金鑰", "立即下線"],
            "fix_prompts_cover": [],
        },
    },
    {
        "name": "tw-payment-hashkey-in-frontend",
        "description": "綠界 HashKey / HashIV 寫在前端 JS（What'Sub 事件同型）。顧問必須說金流金鑰只能在後端，並要求重新申請。",
        "scan": lambda: build(
            "https://shop.example.tw/",
            {"server": "cloudflare", "cf-ray": "8a1b2c3d4e5f-TPE", "strict-transport-security": "max-age=31536000"},
            "<!doctype html><html><head><title>Shop</title></head><body><script src=\"/app.js\"></script></body></html>",
            js='const ecpay = { MerchantID: "3002607", HashKey: "pwFHCqoQZGmho4w6", HashIV: "EkRm7iFT261dpevs" }; export function pay(o){ return fetch("https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5", {method:"POST", body: sign(o, ecpay)}) }',
        ),
        "expect": {
            "risk_level_in": ["危急"],
            "must_mention_any": [["後端", "伺服器端", "server"], ["HashKey", "金流"]],
            "fix_prompts_cover": ["secret_leak"],
        },
    },
]


def build_all() -> dict[str, dict]:
    """產出所有案例（name -> 案例 dict），結果是確定性的，測試會拿來跟 evals/cases 比對。"""
    out: dict[str, dict] = {}
    for case in CASES:
        scan = case["scan"]()
        expect = case["expect"]
        penalized = {i["id"] for i in scan["issues"] if i["penalty"] > 0}
        missing = set(expect.get("fix_prompts_cover", [])) - penalized
        assert not missing, f"{case['name']}: 期望涵蓋的項目沒有被規則引擎抓到：{missing}（實際扣分項：{sorted(penalized)}）"
        out[case["name"]] = {"name": case["name"], "description": case["description"], "scan": scan, "expect": expect}
    return out


def main() -> None:
    CASES_DIR.mkdir(parents=True, exist_ok=True)
    for name, case in build_all().items():
        (CASES_DIR / f"{name}.json").write_text(json.dumps(case, ensure_ascii=False, indent=2), encoding="utf-8")
        scan = case["scan"]
        print(f"{name:<40} score={scan['score']:>3} {scan['grade']}  issues={[i['id'] for i in scan['issues'] if i['penalty'] > 0]}")


if __name__ == "__main__":
    main()
