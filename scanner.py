"""硬規則檢測層：問題目錄、金鑰／混合內容／CSP 等偵測器、技術棧辨識、修復 Prompt 與設定檔產生、evaluate() 計分、run_scan()。"""
from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import re
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

from config import *  # noqa: F401,F403
from netsafe import *  # noqa: F401,F403

# ---------------------------------------------------------------------------
# 4. 硬規則檢測層：目錄、規則、白話說明、修復 Prompt 模板
# ---------------------------------------------------------------------------
ISSUE_CATALOG: dict[str, dict[str, Any]] = {
    "https": {
        "title": "未強制使用 HTTPS",
        "category": "傳輸安全",
        "severity": "high",
        "penalty": 20,
        "description": "你的網站允許用不加密的 http:// 連線。使用者在咖啡廳 Wi-Fi 上輸入的帳號密碼、看的內容，都可能被同一網路的人看光或竄改。",
    },
    "hsts": {
        "title": "缺少 Strict-Transport-Security (HSTS)",
        "category": "傳輸安全",
        "severity": "medium",
        "penalty": 15,
        "description": "瀏覽器不知道你的網站「只能走 HTTPS」。使用者第一次打 http:// 進來時，中間人有機會在加密開始前把他攔下（SSL Stripping）。",
    },
    "x_frame_options": {
        "title": "缺少 X-Frame-Options（點擊劫持防護）",
        "category": "HTTP 安全標頭",
        "severity": "medium",
        "penalty": 15,
        "description": "別人可以把你的網站整個塞進他們網頁的隱形 iframe，誘騙使用者點擊（Clickjacking），例如騙他按下「刪除帳號」或「確認付款」。",
    },
    "csp": {
        "title": "缺少 Content-Security-Policy (CSP)",
        "category": "HTTP 安全標頭",
        "severity": "high",
        "penalty": 20,
        "description": "沒有內容安全政策，代表只要任何一處有 XSS 漏洞（例如留言板沒過濾），攻擊者就能在你的網站上執行任意 JavaScript、偷 Cookie、改頁面。CSP 是最後一道防線。",
    },
    "x_content_type_options": {
        "title": "缺少 X-Content-Type-Options（MIME 嗅探防護）",
        "category": "HTTP 安全標頭",
        "severity": "low",
        "penalty": 10,
        "description": "瀏覽器可能會「猜」檔案類型，把使用者上傳的圖片當成 JavaScript 執行（MIME 嗅探）。加上 nosniff 就能關掉這個猜測。",
    },
    "cookie_httponly": {
        "title": "Cookie 缺少 HttpOnly 屬性",
        "category": "Cookie 安全",
        "severity": "low",
        "penalty": 5,
        "description": "這些 Cookie 可以被頁面上的 JavaScript 讀到。一旦有 XSS，攻擊者一行 document.cookie 就能把登入狀態偷走。",
    },
    "cookie_secure": {
        "title": "Cookie 缺少 Secure 屬性",
        "category": "Cookie 安全",
        "severity": "low",
        "penalty": 5,
        "description": "這些 Cookie 沒有 Secure 屬性，瀏覽器在 http:// 連線時也會把它送出去，可能在網路上被明文攔截。",
    },
    "secret_leak": {
        "title": "前端程式碼疑似外洩 API 金鑰",
        "category": "金鑰外洩",
        "severity": "critical",
        "penalty": 30,
        "description": "前端程式碼裡出現了像是 API 金鑰的字串。任何人按 F12 就能看到並拿去用，輕則帳單被刷爆，重則資料庫被翻光。這是 AI 搭站最常見的事故。",
    },
    "env_exposed": {
        "title": "/.env 檔案可被公開下載",
        "category": "公開檔案裸露",
        "severity": "critical",
        "penalty": 30,
        "description": "網站根目錄的 .env 可以被任何人直接下載，裡面通常有資料庫密碼、API 金鑰、JWT secret。這等於把保險箱鑰匙貼在大門上。",
    },
    "git_exposed": {
        "title": "/.git/config 可被公開讀取",
        "category": "公開檔案裸露",
        "severity": "critical",
        "penalty": 20,
        "description": ".git 目錄公開可讀。攻擊者可以用現成工具把整個原始碼庫連同歷史紀錄下載回去，找出曾出現過的密碼與邏輯漏洞。",
    },
    "referrer_policy": {
        "title": "建議：設定 Referrer-Policy",
        "category": "建議加強",
        "severity": "info",
        "penalty": 0,
        "description": "未設定 Referrer-Policy。使用者從你的網站點外部連結時，完整網址（可能含 token 或個資參數）會被送給對方網站。不扣分，但建議補上。",
    },
    "permissions_policy": {
        "title": "建議：設定 Permissions-Policy",
        "category": "建議加強",
        "severity": "info",
        "penalty": 0,
        "description": "未設定 Permissions-Policy。可明確關閉網站用不到的瀏覽器功能（相機、麥克風、定位），降低第三方腳本濫用的風險。不扣分，但建議補上。",
    },
    # ---- 進階檢查：重大者扣分，其餘為建議 ----
    "mixed_content": {
        "title": "HTTPS 頁面載入 http:// 的腳本或框架（混合內容）",
        "category": "傳輸安全",
        "severity": "medium",
        "penalty": 10,
        "description": "網站本身是 HTTPS，但頁面裡引用了 http:// 的 JavaScript、樣式或 iframe。瀏覽器會直接封鎖這些資源導致功能壞掉，沒封鎖的話等於讓中間人有機會把惡意程式塞進你的加密頁面。",
    },
    "sourcemap_exposed": {
        "title": "前端 source map 可公開下載（原始碼外洩）",
        "category": "原始碼外洩",
        "severity": "low",
        "penalty": 5,
        "description": "打包後的 JS 附帶了 .map 檔，任何人都能還原出你沒壓縮前的原始碼、檔案結構、註解，甚至寫死在裡面的內部網址。這會讓攻擊者更容易找到邏輯漏洞。",
    },
    "cookie_samesite": {
        "title": "建議：Cookie 加上 SameSite 屬性",
        "category": "Cookie 安全",
        "severity": "info",
        "penalty": 0,
        "description": "這些 Cookie 沒有 SameSite 屬性。雖然現代瀏覽器預設當成 Lax，但明確設定 Lax 或 Strict 才能確保跨站請求偽造（CSRF）時不會夾帶登入狀態。",
    },
    "server_version": {
        "title": "建議：不要在回應中洩漏伺服器版本",
        "category": "資訊洩漏",
        "severity": "info",
        "penalty": 0,
        "description": "回應標頭或 HTML 直接寫出伺服器軟體的版本號。攻擊者可以拿版本號去對照已知漏洞清單，省下探測的功夫。關掉不影響功能。",
    },
    "hsts_weak": {
        "title": "建議：HSTS 設定偏弱",
        "category": "傳輸安全",
        "severity": "info",
        "penalty": 0,
        "description": "HSTS 有設但效力打折：max-age 太短代表保護期很快就過，缺少 includeSubDomains 代表子網域仍可能被降級成 http。",
    },
    "csp_weak": {
        "title": "建議：CSP 有設但有漏洞",
        "category": "HTTP 安全標頭",
        "severity": "info",
        "penalty": 0,
        "description": "Content-Security-Policy 存在，但寫法讓它擋不住真正的攻擊：例如 script-src 允許 'unsafe-inline' 或 'unsafe-eval'、允許萬用來源、缺少 object-src 或 base-uri。這種 CSP 對 XSS 幾乎沒有防護力。",
    },
    "sri_missing": {
        "title": "建議：第三方腳本加上 SRI 完整性驗證",
        "category": "供應鏈安全",
        "severity": "info",
        "penalty": 0,
        "description": "頁面從外部 CDN 載入 JavaScript 但沒有 integrity 屬性。如果那個 CDN 被入侵或網域過期被接管，惡意程式碼會直接在你的網站執行。加上 SRI 後，內容一被竄改瀏覽器就拒絕執行。像 GA/GTM 這類會變動的追蹤腳本無法用 SRI，這項只針對固定版本的函式庫。",
    },
    "cross_origin_isolation": {
        "title": "建議：設定 Cross-Origin-Opener-Policy",
        "category": "建議加強",
        "severity": "info",
        "penalty": 0,
        "description": "未設定 COOP。設成 same-origin 可以切斷其他網站透過 window.opener 操控你頁面的管道，降低跨站洩漏（XS-Leaks）類攻擊的風險。若網站有 OAuth 彈窗登入，改用 same-origin-allow-popups。",
    },
    "tls_expiring": {
        "title": "TLS 憑證即將到期",
        "category": "傳輸安全",
        "severity": "medium",
        "penalty": 0,
        "description": "HTTPS 憑證快到期了。一旦過期，所有瀏覽器都會跳出紅色警告、使用者進不來，API 呼叫也會全部失敗。多數平台會自動續期，但這表示自動續期可能沒在運作。",
    },
    "outdated_library": {
        "title": "建議：前端使用了已停止維護的函式庫版本",
        "category": "供應鏈安全",
        "severity": "info",
        "penalty": 0,
        "description": "頁面載入的函式庫版本已經停止安全更新，存在公開的已知漏洞（例如舊版 jQuery 的 XSS）。升級通常不難，而且會一併解決不少潛在問題。",
    },
    "email_spoofing": {
        "title": "建議：設定 SPF / DMARC 防止網域被冒名寄信",
        "category": "郵件安全",
        "severity": "info",
        "penalty": 0,
        "description": "你的網域沒有完整的 SPF 或 DMARC 紀錄，任何人都可以用「@你的網域」寄釣魚信給你的使用者，收件端很難分辨真假。就算網站本身不寄信，也建議設定拒絕政策。",
    },
    "security_txt": {
        "title": "建議：提供 /.well-known/security.txt",
        "category": "建議加強",
        "severity": "info",
        "penalty": 0,
        "description": "沒有 security.txt。這是業界標準的「資安聯絡方式」檔案，有人發現你網站的漏洞時知道該通知誰，而不是直接公開或放著不管。",
    },
    "supabase_rls": {
        "title": "提醒：前端使用 Supabase，請確認每張表都開了 RLS",
        "category": "後端服務設定",
        "severity": "info",
        "penalty": 0,
        "description": "前端程式碼裡有 Supabase 專案網址與 anon key。anon key 放前端是設計上允許的，但它能直接打資料庫的 REST API：只要任何一張表沒開 Row Level Security 或 policy 寫太鬆，任何人都能讀寫整張表。這是 Lovable、Bolt 專案最常見的資料外洩原因。本工具不會去讀你的資料，只能提醒你自己確認。",
    },
    "firebase_rules": {
        "title": "提醒：前端使用 Firebase，請確認 Security Rules 與金鑰限制",
        "category": "後端服務設定",
        "severity": "info",
        "penalty": 0,
        "description": "前端程式碼裡有 Firebase 設定（apiKey、projectId）。這把 apiKey 本來就是公開的，真正的防線是 Firestore / Realtime Database / Storage 的 Security Rules：若還是預設的測試模式（allow read, write: if true）或已過期，任何人都能讀寫你的資料庫。本工具不會去讀你的資料，只能提醒你自己確認。",
    },
}

SECRET_PATTERNS: list[dict[str, Any]] = [
    {"id": "openai", "label": "OpenAI / Anthropic 類型 API Key (sk-…)", "regex": re.compile(r"\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_\-]{20,}"), "mixed_case": True},
    {"id": "google", "label": "Google API Key (AIza…)", "regex": re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b"), "mixed_case": False},
    {"id": "stripe", "label": "Stripe Secret Key (sk_live_…)", "regex": re.compile(r"\bsk_live_[0-9a-zA-Z]{24,}"), "mixed_case": False},
    {"id": "aws", "label": "AWS Access Key ID (AKIA…)", "regex": re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "mixed_case": False},
    {"id": "github", "label": "GitHub Token (ghp_/gho_…)", "regex": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"), "mixed_case": False},
    {"id": "slack", "label": "Slack Token (xox…)", "regex": re.compile(r"\bxox[baprs]-[0-9A-Za-z\-]{10,}"), "mixed_case": False},
    {"id": "private_key", "label": "PEM 私鑰", "regex": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----"), "mixed_case": False},
    {"id": "sendgrid", "label": "SendGrid API Key (SG.…)", "regex": re.compile(r"\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b"), "mixed_case": False},
    {"id": "huggingface", "label": "Hugging Face Token (hf_…)", "regex": re.compile(r"\bhf_[A-Za-z0-9]{34}\b"), "mixed_case": True},
    {"id": "groq", "label": "Groq API Key (gsk_…)", "regex": re.compile(r"\bgsk_[A-Za-z0-9]{52}\b"), "mixed_case": True},
    {"id": "npm", "label": "npm Token (npm_…)", "regex": re.compile(r"\bnpm_[A-Za-z0-9]{36}\b"), "mixed_case": True},
]
JWT_PATTERN = re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b")


def _jwt_payload(token: str) -> dict[str, Any] | None:
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        data = json.loads(base64.urlsafe_b64decode(part).decode("utf-8", errors="replace"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def scan_service_role_jwts(sources: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """Supabase 的 service_role 金鑰是 JWT，payload 的 role 欄位會寫明；anon key 放前端是正常的，不報。"""
    findings: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source_name, text in sources:
        for m in JWT_PATTERN.finditer(text):
            token = m.group(0)
            if token in seen:
                continue
            seen.add(token)
            payload = _jwt_payload(token)
            if payload and str(payload.get("role", "")).lower() == "service_role":
                findings.append({"type": "supabase_service_role", "label": "Supabase service_role 金鑰（可繞過 RLS 讀寫整個資料庫）", "masked": mask_secret(token), "source": source_name})
    return findings

GRADE_TABLE = [(85, "A", "優良"), (70, "B", "尚可"), (50, "C", "待加強"), (0, "F", "高風險")]


def grade_for(score: int) -> tuple[str, str]:
    for threshold, grade, label in GRADE_TABLE:
        if score >= threshold:
            return grade, label
    return "F", "高風險"


def mask_secret(value: str) -> str:
    if len(value) <= 12:
        return value[:3] + "…" + value[-2:]
    return f"{value[:7]}…{value[-4:]}（共 {len(value)} 字元）"


def _looks_random(token: str) -> bool:
    """降低 CSS class（如 sk-chasing-dots-2-child）誤判：真正金鑰同時含數字、大寫、小寫。"""
    return any(c.isdigit() for c in token) and any(c.isupper() for c in token) and any(c.islower() for c in token)


def scan_secrets(sources: list[tuple[str, str]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for source_name, text in sources:
        for pat in SECRET_PATTERNS:
            for m in pat["regex"].finditer(text):
                token = m.group(0)
                if pat["mixed_case"] and not _looks_random(token):
                    continue
                key = (pat["id"], token)
                if key in seen:
                    continue
                seen.add(key)
                findings.append({"type": pat["id"], "label": pat["label"], "masked": mask_secret(token), "source": source_name})
    return findings


def extract_same_origin_scripts(html: str, base_url: str, limit: int = MAX_JS_FILES) -> list[str]:
    base_host = (urlparse(base_url).hostname or "").lower()
    found: list[str] = []
    for m in re.finditer(r"<script\b[^>]*\bsrc\s*=\s*[\"']?([^\"'\s>]+)", html, re.I):
        src = m.group(1).strip()
        if src.startswith(("data:", "javascript:", "blob:")):
            continue
        absolute = urljoin(base_url, src)
        p = urlparse(absolute)
        if p.scheme not in ("http", "https") or (p.hostname or "").lower() != base_host:
            continue
        clean = urlunparse(p._replace(fragment=""))
        if clean not in found:
            found.append(clean)
        if len(found) >= limit:
            break
    return found


def parse_cookie(header: str) -> dict[str, Any]:
    parts = [p.strip() for p in header.split(";")]
    name = parts[0].split("=", 1)[0].strip() or "(unnamed)"
    attrs: dict[str, Any] = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            attrs[k.strip().lower()] = v.strip()
        else:
            attrs[p.lower()] = True
    return {"name": name, "httponly": "httponly" in attrs, "secure": "secure" in attrs, "samesite": attrs.get("samesite")}


def _dedupe(items: list[str]) -> list[str]:
    out: list[str] = []
    for i in items:
        if i not in out:
            out.append(i)
    return out


def _attr(tag: str, name: str) -> str | None:
    m = re.search(rf"\b{name}\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))", tag, re.I)
    if not m:
        return None
    return next(g for g in m.groups() if g is not None)


def mixed_content(html: str, final_scheme: str) -> list[str]:
    """HTTPS 頁面引用 http:// 的主動內容（腳本、樣式、iframe、object）。圖片屬於被動內容，不列。"""
    if final_scheme != "https":
        return []
    found: list[str] = []
    for m in re.finditer(r"<(script|iframe|link|object|embed)\b[^>]*>", html, re.I):
        tag, name = m.group(0), m.group(1).lower()
        src = _attr(tag, "data" if name == "object" else ("href" if name == "link" else "src"))
        if not src or not src.lower().startswith("http://"):
            continue
        if name == "link" and not re.search(r"\brel\s*=\s*[\"']?[^\"'>]*stylesheet", tag, re.I):
            continue
        found.append(f"<{name}> {src[:100]}")
    return _dedupe(found)[:8]


SRI_EXEMPT_HOSTS = (
    "googletagmanager.com", "google-analytics.com", "googlesyndication.com", "doubleclick.net", "google.com", "gstatic.com",
    "connect.facebook.net", "hotjar.com", "js.stripe.com", "segment.com", "clarity.ms", "cloudflareinsights.com",
    "vercel-insights.com", "vercel-scripts.com", "plausible.io", "posthog.com", "sentry-cdn.com", "intercom.io",
    "crisp.chat", "tawk.to", "recaptcha.net", "challenges.cloudflare.com", "hcaptcha.com", "cdn.tailwindcss.com",
)


def scripts_without_sri(html: str, base_url: str) -> list[str]:
    base_host = (urlparse(base_url).hostname or "").lower()
    out: list[str] = []
    for m in re.finditer(r"<script\b[^>]*>", html, re.I):
        tag = m.group(0)
        src = _attr(tag, "src")
        if not src:
            continue
        absolute = urljoin(base_url, src)
        host = (urlparse(absolute).hostname or "").lower()
        if not host or host == base_host or urlparse(absolute).scheme not in ("http", "https"):
            continue
        if any(host == h or host.endswith("." + h) for h in SRI_EXEMPT_HOSTS):
            continue
        if re.search(r"\bintegrity\s*=", tag, re.I):
            continue
        out.append(absolute[:120])
    return _dedupe(out)[:6]


def csp_weaknesses(csp: str) -> list[str]:
    directives: dict[str, list[str]] = {}
    for part in csp.split(";"):
        toks = part.strip().split()
        if toks:
            directives[toks[0].lower()] = [t.lower() for t in toks[1:]]
    script = directives.get("script-src")
    if script is None:
        script = directives.get("default-src", [])
    out: list[str] = []
    has_nonce_or_hash = any(t.startswith(("'nonce-", "'sha256-", "'sha384-", "'sha512-")) for t in script)
    if "'unsafe-inline'" in script and not has_nonce_or_hash:
        out.append("script-src 允許 'unsafe-inline'（沒有 nonce/hash），注入的 inline script 照樣執行")
    if "'unsafe-eval'" in script:
        out.append("script-src 允許 'unsafe-eval'")
    wild = [t for t in script if t in ("*", "http:", "https:", "data:", "blob:")]
    if wild:
        out.append("script-src 允許萬用來源 " + " ".join(wild))
    if "object-src" not in directives and directives.get("default-src") != ["'none'"]:
        out.append("缺少 object-src 'none'（Flash/插件類注入）")
    if "base-uri" not in directives:
        out.append("缺少 base-uri（<base> 標籤劫持相對路徑）")
    return out


def version_disclosures(headers: httpx.Headers, html: str) -> list[str]:
    out: list[str] = []
    for h in ("server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-generator"):
        v = headers.get(h)
        if v and re.search(r"\d+\.\d+", v):
            out.append(f"{h}: {v[:60]}")
    m = re.search(r"<meta[^>]+name\s*=\s*[\"']generator[\"'][^>]*content\s*=\s*[\"']([^\"']+)", html, re.I)
    if m and re.search(r"\d+\.\d+", m.group(1)):
        out.append("meta generator: " + m.group(1)[:60])
    return out


def outdated_libraries(sources: list[tuple[str, str]]) -> list[str]:
    out: list[str] = []
    for _name, text in sources:
        head = text[:200_000]
        for m in re.finditer(r"jQuery(?: JavaScript Library)? v(\d+)\.(\d+)\.(\d+)|jquery-(\d+)\.(\d+)\.(\d+)(?:\.min)?\.js", head, re.I):
            g = [x for x in m.groups() if x is not None]
            ver = tuple(int(x) for x in g[:3])
            if ver < (3, 5, 0):
                out.append(f"jQuery {'.'.join(map(str, ver))}（3.5 以前有已知 XSS，建議升到 3.7+）")
        if re.search(r"AngularJS v1\.\d", head) or re.search(r"angular(?:\.min)?\.js\?v=1\.", head, re.I):
            out.append("AngularJS 1.x（2022 年起停止維護，建議遷移到 Angular 或其他框架）")
        m = re.search(r"Bootstrap v(\d+)\.(\d+)\.(\d+)", head)
        if m and int(m.group(1)) < 4:
            out.append(f"Bootstrap {m.group(1)}.{m.group(2)}.{m.group(3)}（已停止維護，建議升級到 5.x）")
        if re.search(r"Vue\.js v2\.\d", head):
            out.append("Vue 2（2023 年底停止維護，建議升級到 Vue 3）")
    return _dedupe(out)[:6]


def sourcemap_reference(js_text: str, js_url: str) -> str | None:
    """回傳 'inline'（內嵌 data: URL）、同源的 .map 絕對網址，或 None。"""
    m = re.search(r"//[#@]\s*sourceMappingURL=(\S+)", js_text[-800:])
    if not m:
        return None
    ref = m.group(1).strip()
    if ref.lower().startswith("data:"):
        return "inline"
    absolute = urljoin(js_url, ref)
    p = urlparse(absolute)
    if p.scheme not in ("http", "https") or (p.hostname or "").lower() != (urlparse(js_url).hostname or "").lower():
        return None
    return urlunparse(p._replace(fragment=""))


def looks_like_sourcemap(text: str, content_type: str) -> bool:
    head = text[:4000]
    if "text/html" in content_type.lower() or "<html" in head.lower():
        return False
    return head.lstrip().startswith("{") and '"sources"' in head and '"mappings"' in text[:200_000]


HOSTED_SUFFIXES = (
    "vercel.app", "netlify.app", "onrender.com", "github.io", "pages.dev", "workers.dev", "web.app", "firebaseapp.com",
    "herokuapp.com", "fly.dev", "railway.app", "up.railway.app", "lovable.app", "lovableproject.com", "bolt.host",
    "surge.sh", "glitch.me", "repl.co", "replit.app", "replit.dev", "azurewebsites.net", "azurestaticapps.net",
    "cloudfront.net", "amplifyapp.com", "webflow.io", "wixsite.com", "myshopify.com", "squarespace.com",
    "wordpress.com", "blogspot.com", "hf.space", "streamlit.app", "gradio.live", "ngrok.app", "ngrok-free.app",
    "koyeb.app", "deno.dev", "val.run", "zeabur.app", "appspot.com", "run.app", "elasticbeanstalk.com", "cyclic.app",
)
SECOND_LEVEL_TLDS = {"com", "co", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "idv", "game", "ebiz", "club"}


def hosted_platform_suffix(host: str) -> str | None:
    h = host.lower()
    return next((s for s in HOSTED_SUFFIXES if h == s or h.endswith("." + s)), None)


def registrable_domain(host: str) -> str | None:
    labels = host.lower().strip(".").split(".")
    if len(labels) < 2:
        return None
    if len(labels) >= 3 and labels[-2] in SECOND_LEVEL_TLDS and len(labels[-1]) == 2:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


async def dns_txt(client: httpx.AsyncClient, name: str) -> list[str] | None:
    """用 Cloudflare 的 DNS-over-HTTPS 查公開 TXT 紀錄（查的是公開 DNS，不碰目標主機）。"""
    try:
        r = await client.get(
            "https://cloudflare-dns.com/dns-query",
            params={"name": name, "type": "TXT"},
            headers={"accept": "application/dns-json", "User-Agent": USER_AGENT},
            timeout=6.0,
        )
        if r.status_code != 200:
            return None
        answers = r.json().get("Answer") or []
        return [str(a.get("data", "")).replace('" "', "").strip('"') for a in answers if a.get("type") == 16]
    except Exception:
        return None


async def email_dns_check(client: httpx.AsyncClient, host: str) -> dict[str, Any]:
    info: dict[str, Any] = {"domain": None, "spf": None, "dmarc": None, "skipped": None}
    try:
        ipaddress.ip_address(host.strip("[]"))
        info["skipped"] = "目標是 IP 位址，沒有網域可查"
        return info
    except ValueError:
        pass
    hosted = hosted_platform_suffix(host)
    if hosted:
        info["skipped"] = f"{hosted} 是託管平台的共用網域，郵件紀錄由平台管理"
        return info
    domain = registrable_domain(host)
    if not domain:
        info["skipped"] = "無法判斷可註冊網域"
        return info
    info["domain"] = domain
    spf_txt, dmarc_txt = await asyncio.gather(dns_txt(client, domain), dns_txt(client, "_dmarc." + domain))
    info["spf"] = None if spf_txt is None else any(t.lower().startswith("v=spf1") for t in spf_txt)
    info["dmarc"] = None if dmarc_txt is None else any(t.lower().startswith("v=dmarc1") for t in dmarc_txt)
    return info


def looks_like_env(text: str, content_type: str) -> bool:
    head = text[:512].lower()
    if "text/html" in content_type.lower() or "<!doctype" in head or "<html" in head:
        return False  # SPA 對任何路徑都回 200 的 fallback 頁，不是真的 .env
    return re.search(r"^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=", text, re.M) is not None


def looks_like_git_config(text: str, content_type: str) -> bool:
    head = text[:512].lower()
    if "text/html" in content_type.lower() or "<!doctype" in head or "<html" in head:
        return False
    return "[core]" in text or "repositoryformatversion" in text


def detect_tech(headers: httpx.Headers, html: str) -> dict[str, Any]:
    """從標頭與 HTML 特徵推測技術棧；platform 供修復 Prompt 模板選路徑用。"""
    stack: list[str] = []
    server = headers.get("server", "").lower()
    powered = headers.get("x-powered-by", "").lower()
    h = html[:400_000].lower()

    def add(name: str) -> None:
        if name not in stack:
            stack.append(name)

    # 前端框架 / 建置工具
    if "/_next/" in h or "__next_data__" in h or "next.js" in powered:
        add("Next.js")
    if "/_nuxt/" in h or "__nuxt" in h:
        add("Nuxt")
    if "__sveltekit" in h or "/_app/immutable/" in h:
        add("SvelteKit")
    if "ng-version=" in h:
        add("Angular")
    if "data-v-app" in h or "__vue" in h:
        add("Vue")
    if "data-reactroot" in h or "/static/js/main." in h:
        add("React")
    if 'type="module"' in h and "/assets/index-" in h:
        add("Vite")
    if "wp-content" in h or "wp-includes" in h:
        add("WordPress")
    if "astro-island" in h or 'name="generator" content="astro' in h:
        add("Astro")
    if "__remixcontext" in h or "/build/_shared/" in h:
        add("Remix")
    if "___gatsby" in h or "/page-data/" in h:
        add("Gatsby")
    if 'content="hugo' in h:
        add("Hugo")
    if 'content="docusaurus' in h or "docusaurus" in h:
        add("Docusaurus")
    if 'content="framer' in h or "framerusercontent.com" in h:
        add("Framer")
    if 'content="webflow' in h or "webflow.com" in h and "wf-" in h:
        add("Webflow")
    if "cdn.shopify.com" in h or "shopify" in headers.get("x-shopid", "").lower() or "x-shopify-stage" in headers:
        add("Shopify")
    if "wixstatic.com" in h or "x-wix-request-id" in headers:
        add("Wix")
    if "bubble.io" in h and "bubble" in h:
        add("Bubble")
    if "gptengineer" in h or "lovable.dev" in h or "lovable.app" in h:
        add("Lovable")
    if "v0.dev" in h or "v0.app" in h:
        add("v0")
    if "bolt.new" in h or "bolt.host" in h:
        add("Bolt")
    if "supabase.co" in h:
        add("Supabase")
    if "firebaseio.com" in h or "firebaseapp.com" in h or "firebase" in h:
        add("Firebase")
    # 託管平台 / 伺服器
    if "x-vercel-id" in headers or server == "vercel":
        add("Vercel")
    if "x-nf-request-id" in headers or "netlify" in server:
        add("Netlify")
    if "cf-ray" in headers or "cloudflare" in server:
        add("Cloudflare")
    if "x-github-request-id" in headers or "github.com" in server:
        add("GitHub Pages")
    if "x-render-origin-server" in headers:
        add("Render")
    if "fly-request-id" in headers:
        add("Fly.io")
    if "x-amz-cf-id" in headers or "cloudfront" in server:
        add("AWS CloudFront")
    if "express" in powered:
        add("Express")
    if "php" in powered:
        add("PHP")
    if "asp.net" in powered:
        add("ASP.NET")
    if "nginx" in server:
        add("Nginx")
    if "apache" in server:
        add("Apache")
    if "litespeed" in server:
        add("LiteSpeed")

    platform = "generic"
    for name, key in (
        ("Next.js", "nextjs"), ("Nuxt", "nuxt"), ("SvelteKit", "sveltekit"), ("Vercel", "vercel"),
        ("Netlify", "netlify"), ("GitHub Pages", "github-pages"), ("Cloudflare", "cloudflare"),
        ("Express", "express"), ("WordPress", "wordpress"), ("Nginx", "nginx"), ("Apache", "apache"), ("Vite", "vite"),
    ):
        if name in stack:
            platform = key
            break
    return {"stack": stack, "platform": platform}


HEADER_LOCATIONS = {
    "nextjs": "Next.js 專案的 next.config.js / next.config.mjs 裡的 `async headers()`（需要 nonce 的 CSP 則放在 middleware.ts）",
    "nuxt": "Nuxt 專案的 nuxt.config.ts 的 routeRules（或安裝 nuxt-security 模組）",
    "sveltekit": "SvelteKit 的 src/hooks.server.ts（handle 函式中對 response.headers 設值）",
    "vercel": "專案根目錄 vercel.json 的 headers 欄位",
    "netlify": "public/_headers 檔案，或 netlify.toml 的 [[headers]] 區塊",
    "github-pages": "（GitHub Pages 無法自訂 HTTP 標頭）改用 HTML 的 <meta http-equiv> 設 CSP，或遷移到 Cloudflare Pages / Netlify",
    "cloudflare": "Cloudflare 儀表板 Rules → Transform Rules → Modify Response Header（或 Workers）",
    "express": "Express 的 helmet 中介層（`npm install helmet` 後 `app.use(helmet(...))`）",
    "wordpress": "WordPress 主機的 .htaccess（Apache）或 nginx 站台設定，或安裝 HTTP Headers 外掛",
    "nginx": "Nginx 站台設定檔 server 區塊的 `add_header` 指令（記得加 always）",
    "apache": "Apache 的 .htaccess 或 VirtualHost 的 `Header always set` 指令",
    "vite": "部署平台的 headers 設定（Vercel 用 vercel.json、Netlify 用 _headers、自架用 Nginx add_header）",
    "generic": "網站伺服器或反向代理的回應標頭設定（Nginx add_header、Express helmet、或託管平台的 headers 設定）",
}

REDIRECT_LOCATIONS = {
    "nginx": "Nginx 的 80 port server 區塊加上 `return 301 https://$host$request_uri;`",
    "apache": ".htaccess 加上 RewriteCond %{HTTPS} off 與 RewriteRule 轉 https://",
    "express": "Express 中介層檢查 req.secure 或 x-forwarded-proto，不是 https 就 301 轉址",
    "wordpress": "WordPress 一般設定的網站網址改成 https://，並在 .htaccess 加 301 轉址",
}

PUBLIC_ENV_HINT = {
    "nextjs": "NEXT_PUBLIC_ 開頭的變數全部會被打包進瀏覽器",
    "vite": "VITE_ 開頭的變數全部會被打包進瀏覽器",
    "nuxt": "runtimeConfig.public 的內容會暴露給瀏覽器",
    "sveltekit": "PUBLIC_ 開頭（$env/static/public）的變數會暴露給瀏覽器",
}

SERVER_SIDE_HINT = {
    "nextjs": "Next.js Route Handler（app/api/*/route.ts）或 Server Action",
    "nuxt": "server/api/ 目錄下的 Nitro API",
    "sveltekit": "+server.ts 端點",
    "vercel": "Vercel Serverless Function（api/ 目錄）",
    "netlify": "Netlify Function（netlify/functions/）",
    "express": "Express 後端路由",
}

DOTFILE_DENY = {
    "nginx": "在 Nginx 站台設定加上 `location ~ /\\.(?!well-known) { deny all; return 404; }`",
    "apache": "在 .htaccess 加上 `<FilesMatch \"^\\.\"> Require all denied </FilesMatch>`",
    "express": "確認 express.static 指向的目錄沒有 .env，並設定 `express.static(dir, { dotfiles: 'deny' })`",
    "wordpress": "在 .htaccess 加上 `<FilesMatch \"^\\.\"> Require all denied </FilesMatch>` 並確認主機商的檔案權限",
}


def build_fix_prompt(issue_id: str, tech: dict[str, Any], evidence: str = "") -> str:
    platform = tech.get("platform", "generic")
    stack_text = "、".join(tech.get("stack", [])) or "未偵測到明確特徵（請先告訴 AI 你的框架與部署平台）"
    where = HEADER_LOCATIONS.get(platform, HEADER_LOCATIONS["generic"])
    intro = (
        f"你是我的資深資安工程師。我的網站經被動檢測推測技術棧為：{stack_text}。"
        "請先讀取專案結構確認實際使用的框架與部署方式，再進行以下修改，修改後告訴我如何驗證。\n\n"
    )
    outro = (
        "\n\n要求：1) 直接給我完整可貼上的程式碼或設定檔內容；2) 逐行說明用途；"
        "3) 指出可能的副作用與回滾方式；4) 不要改動與此任務無關的檔案。"
    )
    nonce_hint = (
        "Next.js 可在 middleware.ts 產生 nonce 並透過 x-nonce 標頭傳給 App Router，請參考官方 CSP 指南"
        if platform == "nextjs"
        else "若必須使用 inline script，請改用 nonce 或 hash 白名單"
    )
    bodies = {
        "https": (
            "任務：強制所有 HTTP 流量以 301 永久轉址到 HTTPS。"
            f"位置：{REDIRECT_LOCATIONS.get(platform, '若是 Vercel/Netlify 這類平台，到 Domains 設定確認 Redirect to HTTPS 已開啟；自架則在反向代理設定 301 轉址')}。"
            "並確認 https:// 下所有資源（圖片、API、字型、iframe）都不會產生 mixed content 警告。"
        ),
        "hsts": (
            f"任務：加入 Strict-Transport-Security 標頭。位置：{where}。"
            "值：`max-age=31536000; includeSubDomains`（先不要加 preload，等確認所有子網域都支援 HTTPS 再考慮）。"
            "注意：只在 HTTPS 回應中送出此標頭；加了之後一年內瀏覽器都會強制 HTTPS，請先確認所有子網域都有有效憑證。"
        ),
        "x_frame_options": (
            f"任務：防止點擊劫持（Clickjacking）。位置：{where}。"
            "加入 `X-Frame-Options: DENY`（若網站需要被自家其他網域用 iframe 嵌入，改用 `SAMEORIGIN`），"
            "並在 Content-Security-Policy 加上 `frame-ancestors 'none'`（或 'self'），兩者一起設才能同時涵蓋新舊瀏覽器。"
        ),
        "csp": (
            f"任務：建立 Content-Security-Policy。位置：{where}。步驟："
            "1) 先盤點網站用到的外部資源（第三方腳本、字型、圖片、API、iframe）；"
            "2) 先以 `Content-Security-Policy-Report-Only` 上線，觀察瀏覽器 console 有沒有違規；"
            "3) 確認無誤後改成正式的 `Content-Security-Policy`。"
            "起手式：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; "
            "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`。"
            f"請依盤點結果把實際用到的網域加進對應指令，script-src 避免 'unsafe-inline'（{nonce_hint}）。"
        ),
        "x_content_type_options": (
            f"任務：加入 `X-Content-Type-Options: nosniff`。位置：{where}。"
            "這個標頭幾乎沒有副作用，直接加即可；順便確認所有靜態資源都回傳正確的 Content-Type。"
        ),
        "cookie_httponly": (
            f"任務：為 Cookie 加上 HttpOnly 屬性。受影響的 Cookie：{evidence or '（見檢測報告）'}。"
            "請找出程式中設定這些 Cookie 的位置（例如 res.cookie、cookies().set、Set-Cookie 標頭、認證套件設定），加上 `httpOnly: true`。"
            "若某個 Cookie 確實需要被前端 JavaScript 讀取，請說明原因並評估改用其他方式傳遞。"
        ),
        "cookie_secure": (
            f"任務：為 Cookie 加上 Secure 屬性。受影響的 Cookie：{evidence or '（見檢測報告）'}。"
            "請在設定 Cookie 的位置加上 `secure: true`，並建議同時設定 `sameSite: 'lax'`（或 'strict'）。"
            "注意本機 http://localhost 開發環境可能需要依 NODE_ENV 切換 secure 設定。"
        ),
        "secret_leak": (
            f"緊急任務：前端程式碼中疑似洩漏了 API 金鑰（{evidence or '見檢測報告'}）。請依序處理："
            "1) 立刻到對應服務的主控台撤銷並重新產生這把金鑰，這一步比改程式更重要；"
            f"2) 在專案中搜尋這把金鑰以及所有會被打包進前端的敏感變數（{PUBLIC_ENV_HINT.get(platform, '任何在瀏覽器端程式碼中引用的環境變數')}）；"
            f"3) 把需要金鑰的呼叫搬到後端（{SERVER_SIDE_HINT.get(platform, '後端 API 或 Serverless Function')}），前端只呼叫自己的後端；"
            "4) 檢查 git 歷史是否也含有金鑰，必要時用 git filter-repo 清除並強制推送；"
            "5) 加上 .gitignore 與 secret scanning（例如 gitleaks pre-commit）。"
            "若是 Google Maps / Firebase 這類設計上會放前端的公開金鑰，請改在 GCP 主控台設定 HTTP Referrer 限制與 API 範圍限制。"
        ),
        "env_exposed": (
            "緊急任務：網站根目錄的 /.env 檔案可以被公開下載。請依序處理："
            "1) 立刻撤銷並更換 .env 內所有金鑰、資料庫密碼與 secret；"
            f"2) {DOTFILE_DENY.get(platform, '把 .env 移出網站根目錄，或設定伺服器拒絕存取所有以點開頭的檔案；若是 Vercel/Netlify 這類平台，檢查 public/ 或靜態輸出目錄是否誤放了 .env，並改用平台的環境變數設定')}；"
            "3) 確認 .env 已在 .gitignore 且不在部署產物（build output / public 目錄）中；"
            "4) 修好後用瀏覽器或 curl 再次請求 /.env，應回傳 404 或 403。"
        ),
        "git_exposed": (
            "緊急任務：/.git/config 可以被公開讀取，代表整個 .git 目錄（含所有原始碼與歷史紀錄中的金鑰）可能被下載還原。請依序處理："
            f"1) {DOTFILE_DENY.get(platform, '把 .git 目錄移出網站根目錄，或設定伺服器拒絕存取所有以點開頭的路徑')}；"
            "2) 檢查 git 歷史中是否曾提交過金鑰或密碼，若有請全部更換；"
            "3) 修好後再次請求 /.git/config 應回傳 404 或 403；"
            "4) 改用 CI/CD 部署建置產物，不要直接在伺服器上 git clone 到網站根目錄。"
        ),
        "referrer_policy": f"任務：加入 `Referrer-Policy: strict-origin-when-cross-origin`。位置：{where}。",
        "permissions_policy": f"任務：加入 `Permissions-Policy: camera=(), microphone=(), geolocation=()`（依實際需要調整）。位置：{where}。",
        "mixed_content": (
            f"任務：消除混合內容。檢測到 HTTPS 頁面引用了 http:// 的資源：{evidence or '（見檢測報告）'}。"
            "請在專案中搜尋所有 `http://` 開頭的 script、link、iframe、object 引用，改成 https://（若來源不支援 HTTPS 就換掉來源或自行託管）。"
            f"另外在 CSP 加上 `upgrade-insecure-requests` 指令（位置：{where}）當作保險。改完後開瀏覽器 console 確認沒有 Mixed Content 警告。"
        ),
        "sourcemap_exposed": (
            f"任務：停止在正式環境公開 source map。證據：{evidence or '（見檢測報告）'}。依框架處理："
            "Next.js 確認 next.config.js 沒有 `productionBrowserSourceMaps: true`；Vite 在 vite.config 設 `build.sourcemap: false`（需要錯誤追蹤時用 'hidden' 並只上傳到 Sentry 之類的服務）；"
            "Create React App 建置時設 `GENERATE_SOURCEMAP=false`；Nuxt 設 `sourcemap: { client: false }`；Angular 確認 production 設定的 sourceMap 為 false。"
            "自架伺服器可再加一層：Nginx `location ~ \\.map$ { return 404; }`。重新部署後請求那個 .map 網址應回 404。"
        ),
        "cookie_samesite": (
            f"任務：為 Cookie 加上 SameSite 屬性。受影響的 Cookie：{evidence or '（見檢測報告）'}。"
            "在設定這些 Cookie 的地方加上 `sameSite: 'lax'`（一般登入狀態）或 `'strict'`（高敏感操作）。"
            "若 Cookie 需要在跨站 iframe 或第三方情境使用，才設 `sameSite: 'none'` 且必須同時有 `secure: true`。"
        ),
        "server_version": (
            f"任務：關掉伺服器版本號洩漏。檢測到：{evidence or '（見檢測報告）'}。"
            "Nginx 在 http 區塊加 `server_tokens off;`；Apache 設 `ServerTokens Prod` 與 `ServerSignature Off`；"
            "Express 用 `app.disable('x-powered-by')` 或 helmet；PHP 在 php.ini 設 `expose_php = Off`；"
            "WordPress 在 functions.php 加 `remove_action('wp_head', 'wp_generator');`。若是託管平台自動加的標頭，說明無法關閉即可。"
        ),
        "hsts_weak": (
            f"任務：強化 HSTS。目前的問題：{evidence or '（見檢測報告）'}。位置：{where}。"
            "改成 `Strict-Transport-Security: max-age=31536000; includeSubDomains`。加 includeSubDomains 前請先確認所有子網域都有有效的 HTTPS 憑證，否則子網域會打不開。"
        ),
        "csp_weak": (
            f"任務：修補 CSP 的弱點。目前的問題：{evidence or '（見檢測報告）'}。位置：{where}。"
            f"優先處理 script-src：移除 'unsafe-inline'，改用 nonce 或 hash（{nonce_hint}）；移除 'unsafe-eval'（找出依賴 eval/new Function 的套件並升級或替換）；"
            "把萬用來源換成明確的網域清單；補上 `object-src 'none'` 與 `base-uri 'self'`。"
            "請先改成 Content-Security-Policy-Report-Only 觀察 console 沒有違規，再切回正式標頭。"
        ),
        "sri_missing": (
            f"任務：為第三方腳本加上 Subresource Integrity。目前沒有 integrity 的腳本：{evidence or '（見檢測報告）'}。"
            "對每一個固定版本的 CDN 腳本，用 `openssl dgst -sha384 -binary file.js | openssl base64 -A` 算出雜湊（或到 srihash.org），"
            "在 <script> 加上 `integrity=\"sha384-…\" crossorigin=\"anonymous\"`。會動態變動的追蹤腳本（GA、GTM）不適用 SRI，請略過。"
            "更根本的做法：把固定版本的函式庫改成 npm 安裝、隨專案打包，就不依賴外部 CDN。"
        ),
        "cross_origin_isolation": (
            f"任務：加入 `Cross-Origin-Opener-Policy: same-origin`。位置：{where}。"
            "若網站使用 OAuth 彈窗登入（Google / GitHub 登入視窗需要 window.opener），改用 `same-origin-allow-popups`。加完後測試登入流程與所有會開新視窗的功能。"
        ),
        "tls_expiring": (
            f"緊急任務：HTTPS 憑證即將到期（{evidence or '見檢測報告'}）。"
            "若用 Vercel / Netlify / Cloudflare / Render 這類平台，到網域設定頁確認憑證狀態並手動觸發續期，同時檢查 DNS 是否還指向該平台（CAA 紀錄也可能擋住簽發）。"
            "自架的話執行 `certbot renew --dry-run` 看續期是否正常，確認 certbot 的 systemd timer 或 cron 有在跑，並檢查 80 port 的 ACME 驗證路徑沒有被反向代理擋掉。"
        ),
        "outdated_library": (
            f"任務：升級已停止維護的前端函式庫。檢測到：{evidence or '（見檢測報告）'}。"
            "請先在專案中找出這些函式庫的引用位置（CDN <script> 或 package.json），列出升級後會受影響的 API，"
            "再逐一升級到目前的穩定版並修正相容性問題（jQuery 可用 jquery-migrate 過渡）。升級後跑過主要功能確認沒有壞掉。"
        ),
        "email_spoofing": (
            f"任務：為網域設定 SPF 與 DMARC。目前狀況：{evidence or '（見檢測報告）'}。"
            "到 DNS 代管商（Cloudflare、GoDaddy、Gandi 等）新增 TXT 紀錄："
            "1) 根網域 `v=spf1 include:<你寄信服務的 include，例如 _spf.google.com> -all`，網站完全不寄信就用 `v=spf1 -all`；"
            "2) `_dmarc` 子網域 `v=DMARC1; p=quarantine; rua=mailto:你的信箱`，觀察報告一段時間後可升為 `p=reject`；"
            "3) 有寄信的話再加 DKIM（由寄信服務提供公鑰）。設定完用 `nslookup -type=TXT _dmarc.你的網域` 確認。"
        ),
        "supabase_rls": (
            f"任務：稽核 Supabase 的 Row Level Security。偵測到：{evidence or '前端含 Supabase 專案網址與 anon key'}。"
            "請幫我：1) 列出專案所有資料表，逐一確認 RLS 已啟用（Supabase Dashboard → Table Editor 的盾牌圖示，或 SQL：select tablename, rowsecurity from pg_tables where schemaname='public'）；"
            "2) 檢查每張表的 policy，找出 `using (true)` 這種對 anon 角色全開的規則，改成以 auth.uid() 綁定使用者；"
            "3) 確認 service_role key 只出現在後端或 Edge Function 的環境變數，前端程式碼與 git 歷史都沒有；"
            "4) Storage bucket 的 policy 也一併檢查；5) 給我修改後的 SQL 與驗證方式（用 anon key 直接呼叫 REST API 應該讀不到別人的資料）。"
        ),
        "firebase_rules": (
            f"任務：稽核 Firebase 的安全設定。偵測到：{evidence or '前端含 Firebase 設定'}。"
            "請幫我：1) 檢查 Firestore、Realtime Database、Storage 的 Security Rules，找出 `allow read, write: if true` 或 `if request.time < timestamp` 這種測試模式規則，改成以 request.auth.uid 綁定使用者；"
            "2) 到 GCP 主控台 → APIs & Services → Credentials，為這把 Web API Key 設定 HTTP referrer 限制（只允許你的網域）與 API 限制；"
            "3) 若有用 Cloud Functions，確認需要驗證的端點都有檢查 ID token；4) 給我修改後的 rules 內容，並用 Firebase 模擬器或 Rules Playground 驗證未登入者讀不到資料。"
        ),
        "security_txt": (
            "任務：建立 /.well-known/security.txt。內容至少包含 `Contact: mailto:你的資安聯絡信箱`、`Expires: <一年後的 ISO 時間>`、`Preferred-Languages: zh-TW, en`。"
            f"檔案放在靜態資源目錄（Next.js / Vite / CRA 放 public/.well-known/security.txt；{where.split('（')[0] if '（' in where else where} 若無法放靜態檔則加一條路由回傳純文字）。部署後開 https://你的網域/.well-known/security.txt 應能看到內容。"
        ),
    }
    return intro + bodies.get(issue_id, "任務：請依檢測報告修復此項目。") + outro


SECURITY_HEADER_VALUES: dict[str, tuple[str, str]] = {
    "hsts": ("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
    "x_frame_options": ("X-Frame-Options", "DENY"),
    "x_content_type_options": ("X-Content-Type-Options", "nosniff"),
    "referrer_policy": ("Referrer-Policy", "strict-origin-when-cross-origin"),
    "permissions_policy": ("Permissions-Policy", "camera=(), microphone=(), geolocation=()"),
    "cross_origin_isolation": ("Cross-Origin-Opener-Policy", "same-origin"),
    "csp": (
        "Content-Security-Policy-Report-Only",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; "
        "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    ),
}


def build_config_snippets(issues: list[dict[str, Any]], tech: dict[str, Any]) -> list[dict[str, str]]:
    """依偵測到的平台，直接產出可貼上的設定檔（不經 AI）。只列缺少的標頭。"""
    ids = {i["id"] for i in issues}
    wanted: list[tuple[str, str]] = []
    for key, pair in SECURITY_HEADER_VALUES.items():
        if key in ids or (key == "hsts" and "hsts_weak" in ids) or (key == "csp" and "csp_weak" in ids):
            wanted.append(pair)
    need_redirect = "https" in ids
    need_dotfiles = "env_exposed" in ids or "git_exposed" in ids
    if not wanted and not need_redirect and not need_dotfiles:
        return []
    platform = tech.get("platform", "generic")
    csp_note = "CSP 先以 Report-Only 上線，開瀏覽器 console 觀察幾天沒有違規後，再把標頭名稱改成 Content-Security-Policy。" if any(n.startswith("Content-Security-Policy") for n, _ in wanted) else ""
    out: list[dict[str, str]] = []

    def js_list() -> str:
        return ",\n".join(f"  {{ key: {json.dumps(n)}, value: {json.dumps(v)} }}" for n, v in wanted)

    def flat_list(indent: str = "  ") -> str:
        return "\n".join(f"{indent}{n}: {v}" for n, v in wanted)

    if platform == "nextjs":
        out.append({
            "filename": "next.config.js", "title": "Next.js：在 headers() 一次補齊",
            "content": (
                "// next.config.js（由網站安全體檢儀產生）\nconst securityHeaders = [\n" + js_list() + "\n];\n\n"
                "/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  async headers() {\n"
                "    return [{ source: \"/(.*)\", headers: securityHeaders }];\n  },\n};\n\nmodule.exports = nextConfig;\n"
            ),
            "note": "已有 next.config.js 的話，把 headers() 合併進去；用 next.config.mjs 就改成 export default。" + csp_note,
        })
    elif platform in ("vercel", "vite"):
        out.append({
            "filename": "vercel.json", "title": "Vercel：專案根目錄的 vercel.json",
            "content": json.dumps({"headers": [{"source": "/(.*)", "headers": [{"key": n, "value": v} for n, v in wanted]}]}, ensure_ascii=False, indent=2) + "\n",
            "note": "不是部署在 Vercel 的話，Netlify 用 public/_headers、自架用 Nginx 的版本。" + csp_note,
        })
    elif platform in ("netlify", "cloudflare"):
        out.append({
            "filename": "public/_headers", "title": ("Netlify" if platform == "netlify" else "Cloudflare Pages") + "：_headers 檔",
            "content": "/*\n" + flat_list("  ") + "\n",
            "note": ("放在建置輸出目錄（通常是 public/ 或 dist/）。Cloudflare 代理的網站也可到 Rules → Transform Rules → Modify Response Header 逐條加。" if platform == "cloudflare" else "放在 public/ 目錄，建置後會被複製到輸出目錄。") + csp_note,
        })
    elif platform == "sveltekit":
        out.append({
            "filename": "src/hooks.server.ts", "title": "SvelteKit：hooks.server.ts",
            "content": (
                "import type { Handle } from '@sveltejs/kit';\n\nconst securityHeaders: Record<string, string> = {\n"
                + ",\n".join(f"  {json.dumps(n)}: {json.dumps(v)}" for n, v in wanted)
                + "\n};\n\nexport const handle: Handle = async ({ event, resolve }) => {\n  const response = await resolve(event);\n"
                "  for (const [k, v] of Object.entries(securityHeaders)) response.headers.set(k, v);\n  return response;\n};\n"
            ),
            "note": csp_note,
        })
    elif platform == "nuxt":
        out.append({
            "filename": "nuxt.config.ts", "title": "Nuxt：routeRules 加標頭",
            "content": (
                "export default defineNuxtConfig({\n  routeRules: {\n    '/**': {\n      headers: {\n"
                + ",\n".join(f"        {json.dumps(n)}: {json.dumps(v)}" for n, v in wanted)
                + "\n      },\n    },\n  },\n});\n"
            ),
            "note": "或安裝 nuxt-security 模組一次補齊。" + csp_note,
        })
    elif platform == "express":
        lines = "\n".join(f"  res.setHeader({json.dumps(n)}, {json.dumps(v)});" for n, v in wanted)
        content = "// 放在所有路由之前\napp.use((req, res, next) => {\n" + lines + "\n  next();\n});\n"
        if need_redirect:
            content += "\n// 強制 HTTPS（在反向代理後面要先 app.set('trust proxy', 1)）\napp.use((req, res, next) => {\n  if (!req.secure) return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);\n  next();\n});\n"
        if need_dotfiles:
            content += "\n// 靜態目錄拒絕點開頭的檔案（.env、.git）\napp.use(express.static('public', { dotfiles: 'deny' }));\n"
        out.append({"filename": "server.js", "title": "Express：中介層設標頭", "content": content, "note": "也可以 npm install helmet 後用 helmet()，效果相同。" + csp_note})
    elif platform in ("apache", "wordpress"):
        content = "# .htaccess（由網站安全體檢儀產生）\n" + "\n".join(f"Header always set {n} \"{v}\"" for n, v in wanted) + "\n"
        if need_redirect:
            content += "\nRewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]\n"
        if need_dotfiles:
            content += "\n<FilesMatch \"^\\.\">\n  Require all denied\n</FilesMatch>\nRedirectMatch 404 /\\.git\n"
        out.append({"filename": ".htaccess", "title": ("WordPress" if platform == "wordpress" else "Apache") + "：.htaccess", "content": content, "note": "需要 mod_headers 與 mod_rewrite 已啟用。" + csp_note})
    elif platform == "github-pages":
        csp_val = SECURITY_HEADER_VALUES["csp"][1]
        out.append({
            "filename": "index.html", "title": "GitHub Pages：只能用 <meta> 設 CSP",
            "content": f"<meta http-equiv=\"Content-Security-Policy\" content=\"{csp_val.replace('frame-ancestors ' + chr(39) + 'none' + chr(39) + '; ', '')}\">\n",
            "note": "GitHub Pages 無法自訂 HTTP 標頭，HSTS、X-Frame-Options 這些在這裡做不到；需要完整防護請改用 Cloudflare Pages 或 Netlify（免費）。",
        })
    else:  # nginx 與 generic
        content = "# 放進 server { } 區塊（由網站安全體檢儀產生）\n" + "\n".join(f"add_header {n} \"{v}\" always;" for n, v in wanted) + "\n"
        if need_dotfiles:
            content += "\n# 擋掉 .env、.git 等所有點開頭的路徑\nlocation ~ /\\.(?!well-known) { deny all; return 404; }\n"
        if need_redirect:
            content += "\n# 另一個 server 區塊：80 一律轉 443\nserver {\n  listen 80;\n  server_name _;\n  return 301 https://$host$request_uri;\n}\n"
        out.append({"filename": "nginx.conf", "title": "Nginx：add_header 一次補齊" if platform == "nginx" else "自架（Nginx 範例）", "content": content, "note": ("加完 `sudo nginx -t` 檢查語法再 `sudo systemctl reload nginx`。" if platform == "nginx" else "沒偵測到明確平台。若是 Vercel 用 vercel.json、Netlify 用 _headers，寫法見修復 Prompt。") + csp_note})
    if wanted and platform not in ("nginx", "generic", "apache", "wordpress"):
        out.append({"filename": "headers.txt", "title": "標頭清單（任何平台通用）", "content": flat_list("") + "\n", "note": "不管用哪個平台，最終目標就是讓每個回應都帶上這幾行。部署後用 curl -I 你的網址 確認。"})
    return out


def make_issue(issue_id: str, tech: dict[str, Any], evidence: str = "") -> dict[str, Any]:
    spec = ISSUE_CATALOG[issue_id]
    return {
        "id": issue_id,
        "title": spec["title"],
        "category": spec["category"],
        "severity": spec["severity"],
        "penalty": spec["penalty"],
        "description": spec["description"],
        "evidence": evidence,
        "fix_prompt": build_fix_prompt(issue_id, tech, evidence),
    }


def make_pass(issue_id: str, title: str, detail: str) -> dict[str, str]:
    return {"id": issue_id, "title": title, "detail": detail}


def evaluate(
    *,
    input_url: str,
    main: FetchResult,
    http_probe: FetchResult | Exception | None,
    js_results: list[tuple[str, FetchResult | Exception]],
    env_result: FetchResult | Exception,
    git_result: FetchResult | Exception,
    env_variant_results: list[tuple[str, FetchResult | Exception]] | None = None,
    sourcemap_results: list[tuple[str, FetchResult | Exception | str]] | None = None,
    security_txt_result: FetchResult | Exception | None = None,
    dns_info: dict[str, Any] | None = None,
    extra_pages: list[tuple[str, FetchResult | Exception]] | None = None,
) -> dict[str, Any]:
    """純函式：把抓回來的資料轉成計分報告（不做任何網路 I/O，方便單元測試）。"""
    t0 = time.perf_counter()
    html = main.text()
    headers = main.headers
    final = urlparse(main.url)
    tech = detect_tech(headers, html)
    issues: list[dict[str, Any]] = []
    passed: list[dict[str, str]] = []
    notes: list[str] = []
    host_for_probe = final.hostname or ""
    env_variant_results = env_variant_results or []
    sourcemap_results = sourcemap_results or []
    extra_pages = extra_pages or []
    for path, res in extra_pages:
        if isinstance(res, Exception):
            notes.append(f"額外頁面 {path} 無法讀取（{type(res).__name__}），已略過")
        elif res.status >= 400:
            notes.append(f"額外頁面 {path} 回應 HTTP {res.status}，只分析了它的標頭與 Cookie")

    # --- 1. HTTPS 強制 ---
    input_scheme = urlparse(input_url).scheme
    if input_scheme == "http":
        if final.scheme == "https":
            passed.append(make_pass("https", "強制 HTTPS", f"以 http:// 進入後被導向 {main.url}"))
        else:
            issues.append(make_issue("https", tech, f"以 http:// 進入後停留在 {main.url}，沒有導向 https://"))
    elif final.scheme != "https":
        issues.append(make_issue("https", tech, f"https:// 進入卻被降級導向 {main.url}"))
    elif http_probe is None:
        passed.append(make_pass("https", "強制 HTTPS", "目標以 HTTPS 提供服務"))
    elif isinstance(http_probe, Exception):
        passed.append(make_pass("https", "強制 HTTPS", f"http://{host_for_probe}/ 無法連線（{type(http_probe).__name__}），未提供明文服務"))
    elif urlparse(http_probe.url).scheme == "https":
        passed.append(make_pass("https", "強制 HTTPS", f"http://{host_for_probe}/ 回應 {http_probe.hops[0]['status'] if http_probe.hops else http_probe.status} 並導向 {http_probe.url}"))
    else:
        issues.append(make_issue("https", tech, f"http://{host_for_probe}/ 回應 {http_probe.status}，可用明文瀏覽，未導向 https://"))

    # --- 2. 安全標頭 ---
    hsts = headers.get("strict-transport-security")
    if hsts:
        m = re.search(r"max-age=(\d+)", hsts, re.I)
        max_age = int(m.group(1)) if m else 0
        passed.append(make_pass("hsts", "HSTS 已設定", f"Strict-Transport-Security: {hsts}"))
        weak: list[str] = []
        if max_age < 15552000:
            weak.append(f"max-age 只有 {max_age} 秒（少於 6 個月，建議 31536000）")
        if "includesubdomains" not in hsts.lower():
            weak.append("缺少 includeSubDomains")
        if weak:
            issues.append(make_issue("hsts_weak", tech, "；".join(weak)))
    else:
        issues.append(make_issue("hsts", tech, "回應中沒有 Strict-Transport-Security 標頭"))

    csp = headers.get("content-security-policy")
    csp_meta = re.search(r"<meta[^>]+http-equiv\s*=\s*[\"']?content-security-policy[\"']?[^>]*content\s*=\s*[\"']([^\"']+)", html, re.I)
    csp_value = csp or (csp_meta.group(1) if csp_meta else "")
    if csp_value:
        passed.append(make_pass("csp", "CSP 已設定", f"Content-Security-Policy: {csp_value[:200]}{'…' if len(csp_value) > 200 else ''}"))
        weak = csp_weaknesses(csp_value)
        if not csp:
            weak.insert(0, "透過 <meta> 設定，frame-ancestors、report-uri 等指令在 meta 中無效，建議改用 HTTP 標頭")
        if weak:
            issues.append(make_issue("csp_weak", tech, "；".join(weak)))
    else:
        issues.append(make_issue("csp", tech, "回應中沒有 Content-Security-Policy 標頭，HTML 也沒有對應的 <meta>"))

    xfo = headers.get("x-frame-options")
    frame_ancestors = re.search(r"frame-ancestors[^;]*", csp or "", re.I)
    if xfo:
        passed.append(make_pass("x_frame_options", "點擊劫持防護已設定", f"X-Frame-Options: {xfo}"))
    elif frame_ancestors:
        passed.append(make_pass("x_frame_options", "點擊劫持防護已設定", f"透過 CSP {frame_ancestors.group(0)} 提供等效防護（建議仍補上 X-Frame-Options 以涵蓋舊瀏覽器）"))
    else:
        issues.append(make_issue("x_frame_options", tech, "沒有 X-Frame-Options 標頭，CSP 也沒有 frame-ancestors 指令"))

    xcto = headers.get("x-content-type-options", "")
    if "nosniff" in xcto.lower():
        passed.append(make_pass("x_content_type_options", "MIME 嗅探防護已設定", f"X-Content-Type-Options: {xcto}"))
    else:
        issues.append(make_issue("x_content_type_options", tech, "回應中沒有 X-Content-Type-Options: nosniff"))

    if headers.get("referrer-policy"):
        passed.append(make_pass("referrer_policy", "Referrer-Policy 已設定", f"Referrer-Policy: {headers.get('referrer-policy')}"))
    else:
        issues.append(make_issue("referrer_policy", tech, "回應中沒有 Referrer-Policy 標頭"))
    if headers.get("permissions-policy"):
        passed.append(make_pass("permissions_policy", "Permissions-Policy 已設定", f"Permissions-Policy: {headers.get('permissions-policy')[:120]}"))
    else:
        issues.append(make_issue("permissions_policy", tech, "回應中沒有 Permissions-Policy 標頭"))
    coop = headers.get("cross-origin-opener-policy")
    if coop:
        passed.append(make_pass("cross_origin_isolation", "Cross-Origin-Opener-Policy 已設定", f"Cross-Origin-Opener-Policy: {coop}"))
    else:
        issues.append(make_issue("cross_origin_isolation", tech, "回應中沒有 Cross-Origin-Opener-Policy 標頭"))

    # --- 2b. 進階：混合內容、版本洩漏、TLS 憑證 ---
    mixed = mixed_content(html, final.scheme)
    for path, res in extra_pages:
        if isinstance(res, FetchResult) and res.status < 400:
            mixed.extend(f"{path}: {x}" for x in mixed_content(res.text(), urlparse(res.url).scheme))
    if mixed:
        issues.append(make_issue("mixed_content", tech, "；".join(mixed)))
    elif final.scheme == "https":
        passed.append(make_pass("mixed_content", "沒有混合內容", "HTTPS 頁面引用的腳本、樣式與 iframe 都走 https://"))
    versions = version_disclosures(headers, html)
    if versions:
        issues.append(make_issue("server_version", tech, "；".join(versions)))
    else:
        passed.append(make_pass("server_version", "未洩漏伺服器版本", "Server / X-Powered-By / generator 都沒有版本號"))
    if main.tls_not_after:
        days = (main.tls_not_after - time.time()) / 86400
        expires = datetime.fromtimestamp(main.tls_not_after, UTC).strftime("%Y-%m-%d")
        if days < 14:
            issues.append(make_issue("tls_expiring", tech, f"憑證將於 {expires} 到期（剩 {max(days, 0):.0f} 天）"))
        else:
            passed.append(make_pass("tls_cert", "TLS 憑證有效", f"有效至 {expires}（剩 {days:.0f} 天）"))

    # --- 3. Cookie ---
    cookie_sources: list[tuple[str, str]] = [("/", raw) for raw in main.set_cookies]
    for path, res in extra_pages:
        if isinstance(res, FetchResult):
            cookie_sources.extend((path, raw) for raw in res.set_cookies)
    cookies: list[dict[str, Any]] = []
    seen_cookie: set[tuple[str, str]] = set()
    for path, raw in cookie_sources:
        c = parse_cookie(raw)
        if (path, c["name"]) in seen_cookie:
            continue
        seen_cookie.add((path, c["name"]))
        c["label"] = c["name"] if path == "/" else f"{c['name']}（{path}）"
        cookies.append(c)
    if not cookies:
        passed.append(make_pass("cookie", "Cookie 安全屬性", "掃描的頁面沒有設置任何 Cookie，無此風險" if extra_pages else "此頁面沒有設置任何 Cookie，無此風險（登入頁通常才有，可在進階選項加掃 /login）"))
    else:
        no_httponly = [c["label"] for c in cookies if not c["httponly"]]
        no_secure = [c["label"] for c in cookies if not c["secure"]]
        if no_httponly:
            issues.append(make_issue("cookie_httponly", tech, "缺少 HttpOnly 的 Cookie：" + ", ".join(no_httponly[:8])))
        if no_secure:
            issues.append(make_issue("cookie_secure", tech, "缺少 Secure 的 Cookie：" + ", ".join(no_secure[:8])))
        if not no_httponly and not no_secure:
            passed.append(make_pass("cookie", "Cookie 安全屬性", f"共 {len(cookies)} 個 Cookie 都具備 HttpOnly 與 Secure"))
        elif not no_httponly:
            passed.append(make_pass("cookie_httponly", "Cookie HttpOnly", f"共 {len(cookies)} 個 Cookie 都具備 HttpOnly"))
        elif not no_secure:
            passed.append(make_pass("cookie_secure", "Cookie Secure", f"共 {len(cookies)} 個 Cookie 都具備 Secure"))
        no_samesite = [c["label"] for c in cookies if not c["samesite"]]
        if no_samesite:
            issues.append(make_issue("cookie_samesite", tech, "缺少 SameSite 的 Cookie：" + ", ".join(no_samesite[:8])))
        else:
            passed.append(make_pass("cookie_samesite", "Cookie SameSite", f"共 {len(cookies)} 個 Cookie 都有 SameSite"))

    # --- 4. 前端金鑰外洩 ---
    sources: list[tuple[str, str]] = [("首頁 HTML", html)]
    for path, res in extra_pages:
        if isinstance(res, FetchResult) and res.status < 400:
            sources.append((f"頁面 {path}", res.text()))
    js_scanned: list[str] = []
    for js_url, result in js_results:
        if isinstance(result, FetchResult) and result.status == 200:
            sources.append((js_url, result.text()))
            js_scanned.append(js_url)
        else:
            reason = type(result).__name__ if isinstance(result, Exception) else f"HTTP {result.status}"
            notes.append(f"JS 檔案無法讀取，已略過：{js_url}（{reason}）")
    findings = scan_service_role_jwts(sources) + scan_secrets(sources)
    if findings:
        evidence = "；".join(f"{f['label']} {f['masked']} @ {f['source']}" for f in findings[:6])
        issue = make_issue("secret_leak", tech, evidence)
        issue["findings"] = findings
        if all(f["type"] == "google" for f in findings):
            issue["description"] += " 提醒：Google Maps / Firebase 的 API Key 設計上可放前端，但務必在 GCP 主控台設定 HTTP Referrer 與 API 範圍限制，否則仍會被盜刷。"
        if any(f["type"] == "supabase_service_role" for f in findings):
            issue["description"] += " 特別注意：Supabase 的 service_role 金鑰會繞過所有 Row Level Security，等於資料庫的 root 密碼，前端只能用 anon key。"
        issues.append(issue)
    else:
        passed.append(make_pass("secret_leak", "前端程式碼未發現 API 金鑰", f"已掃描首頁 HTML 與 {len(js_scanned)} 個站內 JS（{len(SECRET_PATTERNS) + 1} 種金鑰特徵，含 Supabase service_role JWT）"))

    # --- 4a. 後端服務設定提醒：Supabase / Firebase（不讀資料，只看前端有沒有設定）---
    all_text = "\n".join(t[:400_000] for _, t in sources)
    sb_url = re.search(r"https://([a-z0-9-]+)\.supabase\.co", all_text)
    if sb_url:
        has_anon = any(str((_jwt_payload(mm.group(0)) or {}).get("role", "")).lower() == "anon" for mm in JWT_PATTERN.finditer(all_text))
        issues.append(make_issue("supabase_rls", tech, f"Supabase 專案 {sb_url.group(1)}.supabase.co" + ("，前端帶有 anon key" if has_anon else "")))
    fb = re.search(r"[\"']?(?:projectId|authDomain)[\"']?\s*:\s*[\"']([a-z0-9-]+)(?:\.firebaseapp\.com)?[\"']", all_text)
    if fb and re.search(r"firebaseapp\.com|firebaseio\.com|firebase", all_text, re.I):
        issues.append(make_issue("firebase_rules", tech, f"Firebase 專案 {fb.group(1)}"))

    # --- 4b. 進階：SRI、過時函式庫、source map ---
    no_sri = scripts_without_sri(html, main.url)
    if no_sri:
        issues.append(make_issue("sri_missing", tech, "；".join(no_sri)))
    else:
        passed.append(make_pass("sri_missing", "第三方腳本已有 SRI 或無外部腳本", "首頁沒有缺少 integrity 屬性的固定版本外部腳本"))
    old_libs = outdated_libraries(sources)
    if old_libs:
        issues.append(make_issue("outdated_library", tech, "；".join(old_libs)))
    else:
        passed.append(make_pass("outdated_library", "未偵測到已停止維護的函式庫", "首頁與站內 JS 沒有舊版 jQuery、AngularJS 1.x、Bootstrap 3、Vue 2 的特徵"))
    exposed_maps: list[str] = []
    for js_url, result in sourcemap_results:
        if result == "inline":
            exposed_maps.append(f"{js_url} 內嵌了完整 source map")
        elif isinstance(result, FetchResult) and result.status == 200 and looks_like_sourcemap(result.text(), result.headers.get("content-type", "")):
            exposed_maps.append(f"{js_url} 的 .map 可下載（{len(result.body)} bytes{'+' if result.truncated else ''}）")
    if exposed_maps:
        issues.append(make_issue("sourcemap_exposed", tech, "；".join(exposed_maps)))
    elif js_scanned:
        passed.append(make_pass("sourcemap_exposed", "source map 未公開", f"已檢查 {len(js_scanned)} 個站內 JS 的 sourceMappingURL"))

    # --- 5. 公開檔案裸露 ---
    def exposed_check(result: FetchResult | Exception, predicate, path: str) -> tuple[bool, str]:
        if isinstance(result, Exception):
            return False, f"{path} 無法取得回應（{type(result).__name__}），視為未裸露"
        if result.status != 200:
            return False, f"{path} 回應 HTTP {result.status}"
        text = result.text()
        if not text.strip():
            return False, f"{path} 回應 200 但內容為空"
        if predicate(text, result.headers.get("content-type", "")):
            return True, f"{path} 回應 200 且內容符合特徵（{len(result.body)} bytes）"
        return False, f"{path} 回應 200 但內容不是該類型檔案（多半是 SPA 的 fallback 頁面）"

    env_hits: list[str] = []
    env_details: list[str] = []
    for path, res in [("/.env", env_result), *env_variant_results]:
        hit, detail = exposed_check(res, looks_like_env, path)
        (env_hits if hit else env_details).append(detail)
    if env_hits:
        issues.append(make_issue("env_exposed", tech, "；".join(env_hits)))
    else:
        passed.append(make_pass("env_exposed", "/.env 系列檔案未裸露", "；".join(env_details)))
    git_hit, git_detail = exposed_check(git_result, looks_like_git_config, "/.git/config")
    if git_hit:
        issues.append(make_issue("git_exposed", tech, git_detail))
    else:
        passed.append(make_pass("git_exposed", "/.git/config 未裸露", git_detail))

    # --- 5b. 進階：security.txt、郵件防冒名（SPF / DMARC） ---
    if security_txt_result is not None:
        ok = (
            isinstance(security_txt_result, FetchResult)
            and security_txt_result.status == 200
            and "text/html" not in security_txt_result.headers.get("content-type", "").lower()
            and "contact:" in security_txt_result.text()[:4000].lower()
        )
        if ok:
            passed.append(make_pass("security_txt", "已提供 security.txt", "/.well-known/security.txt 存在且含 Contact 欄位"))
        else:
            issues.append(make_issue("security_txt", tech, "/.well-known/security.txt 不存在或不含 Contact 欄位"))
    if dns_info:
        if dns_info.get("skipped"):
            notes.append("略過 SPF / DMARC 檢查：" + str(dns_info["skipped"]))
        elif dns_info.get("spf") is None and dns_info.get("dmarc") is None:
            notes.append("DNS 查詢失敗，略過 SPF / DMARC 檢查")
        else:
            missing = [name for name, ok in (("SPF", dns_info.get("spf")), ("DMARC", dns_info.get("dmarc"))) if not ok]
            if missing:
                issues.append(make_issue("email_spoofing", tech, f"{dns_info['domain']} 缺少 {'、'.join(missing)} 紀錄"))
            else:
                passed.append(make_pass("email_spoofing", "SPF / DMARC 已設定", f"{dns_info['domain']} 的 SPF 與 DMARC 紀錄都存在"))

    # --- 6. 計分 ---
    score = max(0, 100 - sum(i["penalty"] for i in issues))
    grade, grade_label = grade_for(score)
    severity_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    issues.sort(key=lambda i: (severity_rank.get(i["severity"], 9), -i["penalty"]))

    if main.status >= 400:
        notes.append(f"目標首頁回應 HTTP {main.status}，可能有 WAF 或機器人防護，標頭與內容分析結果僅供參考")
    if main.truncated:
        notes.append(f"首頁 HTML 超過 {MAX_HTML_BYTES // 1000} KB，只分析了前段內容")

    snapshot_keys = [
        "strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options",
        "referrer-policy", "permissions-policy", "server", "x-powered-by", "set-cookie",
    ]
    snapshot = {k: (headers.get(k)[:300] if headers.get(k) else None) for k in snapshot_keys}

    return {
        "target": {
            "input_url": input_url,
            "final_url": main.url,
            "hostname": final.hostname,
            "scheme": final.scheme,
            "status_code": main.status,
        },
        "score": score,
        "grade": grade,
        "grade_label": grade_label,
        "tech": tech,
        "issues": issues,
        "passed": passed,
        "config_snippets": build_config_snippets(issues, tech),
        "headers": snapshot,
        "details": {
            "redirect_chain": main.hops,
            "js_files_scanned": js_scanned,
            "extra_pages": [{"path": p, "status": (r.status if isinstance(r, FetchResult) else None), "error": (type(r).__name__ if isinstance(r, Exception) else None)} for p, r in extra_pages],
            "engine_ms": round((time.perf_counter() - t0) * 1000, 2),
            "html_bytes": len(main.body),
            "notes": notes,
        },
    }


def normalize_extra_paths(paths: list[str]) -> list[str]:
    """使用者自填的額外路徑：只接受 / 開頭的站內路徑，最多 MAX_EXTRA_PATHS 個。"""
    out: list[str] = []
    for raw in paths:
        p = (raw or "").strip()
        if not p or p == "/" or not p.startswith("/") or p.startswith("//") or "://" in p or any(ch.isspace() for ch in p) or len(p) > 200:
            continue
        if p not in out:
            out.append(p)
    return out[:MAX_EXTRA_PATHS]


async def run_scan(input_url: str, extra_paths: list[str] | None = None) -> dict[str, Any]:
    t_start = time.perf_counter()
    extra_paths = normalize_extra_paths(extra_paths or [])
    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        follow_redirects=False,
        limits=httpx.Limits(max_connections=8),
    ) as client:
        main = await safe_fetch(client, input_url, max_bytes=MAX_HTML_BYTES)
        final = urlparse(main.url)
        origin = f"{final.scheme}://{final.netloc}"
        html = main.text()
        js_urls = extract_same_origin_scripts(html, main.url)

        tasks: list[Any] = []
        probe_needed = urlparse(input_url).scheme == "https" and final.scheme == "https"
        if probe_needed:
            tasks.append(safe_fetch(client, f"http://{final.hostname}/", max_bytes=1024, max_redirects=3))
        for js in js_urls:
            tasks.append(safe_fetch(client, js, max_bytes=MAX_JS_BYTES))
        env_paths = ["/.env", "/.env.local", "/.env.production"]
        for path in env_paths:
            tasks.append(safe_fetch(client, origin + path, max_bytes=MAX_PROBE_BYTES, follow_redirects=False))
        tasks.append(safe_fetch(client, origin + "/.git/config", max_bytes=MAX_PROBE_BYTES, follow_redirects=False))
        tasks.append(safe_fetch(client, origin + "/.well-known/security.txt", max_bytes=MAX_PROBE_BYTES, follow_redirects=False))
        tasks.append(email_dns_check(client, final.hostname or ""))
        for path in extra_paths:
            tasks.append(safe_fetch(client, origin + path, max_bytes=MAX_HTML_BYTES))
        results = await asyncio.gather(*tasks, return_exceptions=True)

        idx = 0
        http_probe: FetchResult | Exception | None = None
        if probe_needed:
            http_probe = results[idx]
            idx += 1
        js_results = []
        for js in js_urls:
            js_results.append((js, results[idx]))
            idx += 1
        env_result = results[idx]
        env_variant_results = list(zip(env_paths[1:], results[idx + 1: idx + 3], strict=False))
        idx += 3
        git_result, security_txt_result, dns_result = results[idx], results[idx + 1], results[idx + 2]
        dns_info = dns_result if isinstance(dns_result, dict) else None
        idx += 3
        extra_pages = list(zip(extra_paths, results[idx: idx + len(extra_paths)], strict=False))

        # 第二輪：站內 JS 若宣告了 source map，各多抓一次（只抓同源的 .map）
        sourcemap_results: list[tuple[str, FetchResult | Exception | str]] = []
        map_tasks: list[tuple[str, Any]] = []
        for js_url, result in js_results:
            if isinstance(result, FetchResult) and result.status == 200:
                ref = sourcemap_reference(result.text(), js_url)
                if ref == "inline":
                    sourcemap_results.append((js_url, "inline"))
                elif ref:
                    map_tasks.append((js_url, safe_fetch(client, ref, max_bytes=MAX_PROBE_BYTES, follow_redirects=False)))
        if map_tasks:
            map_fetched = await asyncio.gather(*(t for _, t in map_tasks), return_exceptions=True)
            sourcemap_results.extend((js_url, res) for (js_url, _), res in zip(map_tasks, map_fetched, strict=False))

    report = evaluate(
        input_url=input_url, main=main, http_probe=http_probe,
        js_results=js_results, env_result=env_result, git_result=git_result,
        env_variant_results=env_variant_results, sourcemap_results=sourcemap_results,
        security_txt_result=security_txt_result, dns_info=dns_info, extra_pages=extra_pages,
    )
    fetches = [r for r in results if not isinstance(r, dict)] + [r for _, r in sourcemap_results if r != "inline"]
    requests_made = main.requests_made + sum(
        r.requests_made if isinstance(r, FetchResult) else 1 for r in fetches
    )
    report["details"]["requests_made"] = requests_made
    report["details"]["total_ms"] = round((time.perf_counter() - t_start) * 1000)
    report["scanned_at"] = datetime.now(UTC).isoformat()
    return report


def normalize_target(raw: str) -> str:
    s = raw.strip()
    if not s:
        raise ValueError("請輸入網址")
    if "://" not in s:
        s = "https://" + s
    p = urlparse(s)
    if p.scheme not in ("http", "https"):
        raise ValueError("僅支援 http:// 或 https:// 開頭的網址")
    if not p.hostname:
        raise ValueError("網址缺少主機名稱")
    if p.username or p.password:
        raise ValueError("網址不可包含帳號密碼")
    try:
        _ = p.port
    except ValueError as exc:
        raise ValueError("連接埠格式錯誤") from exc
    return urlunparse((p.scheme, p.netloc, p.path or "/", "", p.query, ""))
