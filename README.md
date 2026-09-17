# AI 網站安全體檢儀 + 智慧資安顧問

**AI-Powered Passive Web Security Auditor**
給用 Cursor / v0 / Bolt / Lovable 搭站、但沒有資安背景的開發者與學生。輸入網址，30 秒內拿到評分、白話風險解讀，以及可以直接貼給 AI 的修復 Prompt。

**Live：https://ai-web-security-auditor.onrender.com** · [範例報告](https://ai-web-security-auditor.onrender.com/) · [API 文件](https://ai-web-security-auditor.onrender.com/api/docs) · MIT License

<details>
<summary><strong>English summary</strong></summary>

A passive, non-intrusive web security auditor for people who ship sites with AI tools (Cursor, v0, Bolt, Lovable) but have no security background. Paste a URL and get, in about 30 seconds:

- a 0–100 score and A/B/C/F grade based on HTTPS enforcement, security headers, cookie flags, leaked API keys in front-end code (including Supabase `service_role` JWTs), exposed `/.env` and `/.git/config`, mixed content and public source maps, plus ten advisory checks (CSP quality, SRI, TLS expiry, SPF/DMARC, outdated libraries…);
- a plain-language explanation of each finding;
- copy-paste fix prompts for Cursor / Claude, tailored to the detected stack (Next.js, Vercel, Netlify, Nginx, Express…), and ready-to-use config files (`next.config.js`, `vercel.json`, `_headers`, nginx, `.htaccess`);
- an AI advisor (Claude Sonnet 5 with Gemini fallback, daily cost cap) you can ask follow-up questions.

It only sends the handful of GET requests a normal browser would (homepage, two same-origin scripts and their source maps, `/.env*`, `/.git/config`, `security.txt`) and queries public DNS. No injection, brute force, directory enumeration or port scanning. SSRF-safe: every hop is resolved and pinned to a public IP. Single-file FastAPI backend, static front end, 77 offline tests, deploys to Render's free tier. See [DEPLOY.md](DEPLOY.md).

</details>

## 3 步驟啟動（Windows PowerShell）

步驟 1：建立虛擬環境並安裝依賴

```powershell
cd ai-web-security-auditor
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

步驟 2：設定金鑰（可跳過，跳過時 AI 顧問會自動改用規則引擎的靜態指引）

```powershell
Copy-Item .env.example .env
notepad .env      # 填入 OPENAI_API_KEY 或 ANTHROPIC_API_KEY 其中之一
```

步驟 3：啟動

```powershell
uvicorn main:app --reload --port 8000
```

打開 http://127.0.0.1:8000 即可使用。macOS / Linux 把啟用虛擬環境改成 `source .venv/bin/activate`、複製改成 `cp .env.example .env`，其餘相同。

跑測試：

```powershell
pip install -r requirements-dev.txt
python -m pytest -q
```

全部離線（LLM 與目標網站都用模擬），涵蓋 SSRF 判定、金鑰正則、SPA fallback、計分、進階檢查、供應商備援與額度、限流與統計、設定檔產生。GitHub Actions 每次 push 自動跑。

## 架構

| 層 | 位置 | 說明 |
|---|---|---|
| 設定 | `config.py` | 所有環境變數、逾時、限流參數、模型與價格表 |
| 網路安全 | `netsafe.py` | SSRF 防護：黑名單主機、每個 IP 都要是公網、連線釘在驗證過的 IP、每一跳轉址重新驗證、回應大小上限 |
| 硬規則檢測層 | `scanner.py` | 純被動 GET、確定性計分、毫秒級，不用 LLM；技術棧辨識、`build_config_snippets()` 設定檔產生、`run_scan()` 併發抓取 |
| 知識庫層 | `knowledge.py` + `knowledge/` | 標籤式檢索（RAG 預留介面）+ few-shot 範例，改 Markdown 就能讓建議越調越準 |
| 狀態 | `state.py` | 滑動視窗限流、每日額度（次數 + 美元）、使用統計、徽章快取、Upstash 快照持久化 |
| AI 顧問層 | `advisor.py` | Claude 官方 SDK（結構化輸出 + prompt cache）→ Gemini 相容端點 → 規則模式三段備援，支援追問 |
| HTTP 層 | `main.py` | FastAPI 路由、安全標頭 middleware、Turnstile / API 金鑰、頁面渲染 |
| 前端 | `index.html` / `static/app.js` | 單頁 Tailwind 深色介面，分數儀表板、風險卡片、一鍵複製 Prompt、AI 追問、範例報告、分享連結（報告壓縮進網址 `#`，不經伺服器）、重掃比較（localStorage）、列印 |
| 測試 / 品質 | `tests/`、`pyproject.toml` | pytest（`python -m pytest`）、ruff、mypy；GitHub Actions 每次 push 自動跑 |

模組之間刻意用 star import 單向分層：`config ← netsafe ← scanner ← knowledge ← state ← advisor ← main`。

## 檢測規則與計分（基礎分 100）

| 項目 | 扣分 |
|---|---|
| 未強制 HTTPS | 20 |
| 缺少 Strict-Transport-Security | 15 |
| 缺少 X-Frame-Options（CSP frame-ancestors 可抵） | 15 |
| 缺少 Content-Security-Policy（含 meta 標籤） | 20 |
| 缺少 X-Content-Type-Options: nosniff | 10 |
| Cookie 缺 HttpOnly / 缺 Secure | 5 / 5 |
| 前端 HTML 或前 2 個站內 JS 出現 API 金鑰 | 30 |
| `/.env`、`/.env.local`、`/.env.production` 回 200 且內容像 env 檔 | 30（一次） |
| `/.git/config` 回 200 且內容像 git 設定 | 20 |
| HTTPS 頁面載入 http:// 的腳本、樣式或 iframe（混合內容） | 10 |
| 站內 JS 的 source map 可下載或內嵌 | 5 |
| Referrer-Policy、Permissions-Policy | 0（僅建議） |

評等：85 分以上 A、70–84 B、50–69 C、50 以下 F。
`/.env` 與 `/.git/config` 會辨識 SPA 的 fallback 頁面（回 200 但內容是 HTML），不會誤判。
金鑰特徵除了 OpenAI / Google / Stripe / AWS / GitHub / Slack / PEM 私鑰 / 藍新與綠界金流的 HashKey · HashIV，還會解開前端出現的 JWT，看到 `role: service_role`（Supabase 的資料庫 root 金鑰）直接判定外洩；anon key 不會被誤報。

**不扣分的進階建議**（每項都附白話說明與修復 Prompt）：

| 項目 | 怎麼判斷 |
|---|---|
| CSP 有設但有漏洞 | script-src 允許 `'unsafe-inline'`（無 nonce/hash）或 `'unsafe-eval'`、萬用來源、缺 object-src / base-uri、只用 `<meta>` 設定 |
| HSTS 偏弱 | max-age 少於 6 個月、缺 includeSubDomains |
| Cookie 缺 SameSite | Set-Cookie 沒有 SameSite 屬性 |
| 伺服器版本洩漏 | Server / X-Powered-By / meta generator 含版本號 |
| 第三方腳本缺 SRI | 外部 CDN 腳本沒有 integrity（GA/GTM 等動態腳本已排除） |
| 缺 Cross-Origin-Opener-Policy | 沒有 COOP 標頭 |
| TLS 憑證即將到期 | 從連線的憑證讀 notAfter，剩不到 14 天 |
| 過時函式庫 | jQuery < 3.5、AngularJS 1.x、Bootstrap 3、Vue 2 |
| 缺 SPF / DMARC | 向公開 DNS 查 TXT；託管平台子網域（vercel.app 等）自動略過 |
| 缺 security.txt | `/.well-known/security.txt` 不存在或無 Contact |

## 法律邊界與防護

- **只做被動檢查**：每次體檢最多送出約 12 個一般瀏覽器也會送的 GET 請求（首頁、http 轉址探測、站內 JS 與其 source map、`/.env` 系列三個、`/.git/config`、`security.txt`），另向 Cloudflare 的公開 DNS 查 SPF / DMARC。沒有注入、爆破、目錄列舉、port 掃描，也不會拿抓到的金鑰去呼叫任何服務。
- **SSRF 阻絕**：目標網域解析出的每一個 IP 都必須是公開位址（私有、loopback、link-local、保留、多播全部拒絕），`localhost`、`*.local`、`*.internal` 等主機名稱直接擋。實際連線會**釘選到已驗證的 IP**，Host 與 SNI 仍用原網域，因此 DNS Rebinding 也無效。每一跳轉址都重新驗證。
- **限流**：同一來源 IP 每分鐘 3 次體檢、10 次 AI 顧問呼叫（記憶體滑動視窗，可用環境變數調整）。
- **授權聲明**：前端必須勾選授權才能送出，後端也會再驗一次。
- **本工具自身**也送出 CSP、X-Frame-Options、nosniff 等標頭。

## 環境變數

見 `.env.example`。`OPENAI_API_KEY` 與 `ANTHROPIC_API_KEY` 擇一；都沒有時 `/api/ai-consult` 會回傳規則引擎產生的靜態修復指引（`mode: "fallback"`），不會報錯。LLM 呼叫失敗（額度用完、網路問題）也會自動降級。

**用 Gemini 也可以**：Google AI Studio 的金鑰可透過 OpenAI 相容端點使用，把 `OPENAI_BASE_URL` 設成 `https://generativelanguage.googleapis.com/v1beta/openai`、`OPENAI_MODEL` 設成 `gemini-3.5-flash`，金鑰照樣填在 `OPENAI_API_KEY`。程式會依端點自動切換 `max_tokens` / `max_completion_tokens` 參數。注意 Google Maps 金鑰通常有 API 限制，不能拿來呼叫 Gemini。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| `POST` | `/api/scan` | `{"url": "...", "authorized": true}` → 評分報告 JSON |
| `POST` | `/api/ai-consult` | `{"scan": <報告>}` → 白話總評 + 修復 Prompt；加上 `"question"` 與 `"history"` 即為追問 |
| `GET` | `/api/health` | 目前 LLM 供應商、每日額度用量、金鑰長度（供部署確認） |
| `GET` | `/stats` | 給人看的使用量頁面 |
| `GET` | `/api/sample` | 範例報告（虛構網站 demo-shop.vercel.app，含預先產生的 AI 顧問結果），首頁「看範例報告」用 |
| `GET` | `/badge/{host}.svg` | 徽章：顯示該網域 7 天內最近一次授權掃描的評等，沒掃過就是灰色 not scanned |

`POST /api/scan` 的完整參數：`{"url": "...", "authorized": true, "paths": ["/login", "/dashboard"], "auto_paths": true, "turnstile_token": "..."}`。`paths` 最多 5 個站內路徑，會一併抓取並合併 Cookie、金鑰、混合內容檢查（登入頁通常才會設 Cookie）。`auto_paths` 會讀 `/sitemap.xml`（沒有就看 `robots.txt` 的 `Sitemap:`，支援 sitemap index 前 2 個子檔），優先挑登入／帳號／後台類頁面補到 5 個，結果寫在 `details.auto_paths` 與 `details.notes`。`turnstile_token` 只在部署端啟用 Turnstile 時需要；帶 `X-Api-Key` 標頭（值在 `API_KEYS` 環境變數裡）的自動化呼叫可跳過。

### 在 CI 裡自動體檢

[examples/github-actions-security-audit.yml](examples/github-actions-security-audit.yml) 是可直接複製的 GitHub Actions 範例：部署完成或每週自動掃描自己的網站，分數低於門檻就讓 CI 失敗，完整報告會附在 job summary 與 artifact。需要在體檢儀的 `API_KEYS` 設一把金鑰並放進 repo 的 secret。

### 徽章

掃描後按「取得徽章」會給 Markdown 與 HTML 片段：

```markdown
[![Web Security](https://ai-web-security-auditor.onrender.com/badge/your-app.vercel.app.svg)](https://ai-web-security-auditor.onrender.com/?url=your-app.vercel.app)
```

徽章只反映經授權掃描的結果，任何人都無法用徽章網址觸發掃描。
| `POST` | `/api/feedback` | `{"kind": "issue\|ai\|snippet", "issue_id": "csp", "vote": "up\|down"}` → 修復 Prompt 有沒有幫助的計數（每 IP 每分鐘 30 次，不記 IP） |
| `GET` | `/api/stats` | 使用量彙總：今日與啟動以來的掃描數、AI 顧問數、不重複 IP、評等分布、常見平台、最近 7 天每日數。不含目標網址。設 `STATS_TOKEN` 後需帶 `?token=` |
| `GET` | `/api/whoami` | 回報呼叫者被辨識成哪個 IP（確認反向代理設定） |
| `POST` | `/api/knowledge/reload` | 編輯 `knowledge/` 後不重啟即生效 |

## 讓建議越調越準（不重訓模型）

1. 在 `knowledge/` 新增或修改 Markdown，第一行寫 `tags: nextjs, csp, ...`。標籤會和偵測到的技術棧、缺失項目 id 做比對，命中的文件會注入 System Prompt。
2. 在 `knowledge/fewshot.json` 放入你滿意的輸入／輸出範例，模型會模仿其風格。改完 System Prompt 或知識庫後，用 `python evals/run_eval.py` 跑顧問評測集（`evals/cases/*.json`，6 個合成案例：Next.js 缺標頭、Lovable 金鑰外洩、Netlify .env 裸露、自架 nginx 純 HTTP、全過的乾淨站、綠界 HashKey 在前端），規則會檢查風險等級、有沒有提到正確平台的設定檔、有沒有給錯平台的檔案、每個扣分項都有修復 Prompt；一次約 0.25 美元。`--dry` 只驗結構不花錢，CI 就是這樣跑。規則引擎改了要重跑 `python evals/build_cases.py` 更新案例。`knowledge/vibe-coding-launch.md`（tags: general）是每次都會帶上的「上線前五問」框架與 What'Sub 案例，研究筆記在 `docs/research/`。
3. 呼叫 `POST /api/knowledge/reload`。
4. 要升級成向量 RAG，只需改寫 `KnowledgeBase.retrieve()`。

## 部署到公網

正式網址：**https://ai-web-security-auditor.onrender.com**。完整步驟見 [DEPLOY.md](DEPLOY.md)。摘要：repo 在 GitHub，Render 讀 `render.yaml` 自動建服務，只需在 Render 後台填 `OPENAI_API_KEY`。

公開服務用的保護（都可用環境變數調整）：

| 變數 | 預設 | 作用 |
|---|---|---|
| `LLM_PROVIDER` | auto | 供應商順序，例如 `anthropic,openai`：前者失敗（額度、429、拒答）換後者，全掛才降級成規則模式 |
| `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` | claude-sonnet-5 / medium | Claude 模型與思考深度（官方 SDK，結構化輸出 + prompt caching） |
| `LLM_DAILY_BUDGET_USD` | 2 | Claude 每日估算費用上限（美元），達到後改用下一個供應商 |
| `OPENAI_MODEL` | 逗號分隔清單 | 429 / 5xx / 逾時時依序換下一個模型 |
| `LLM_DAILY_BUDGET` | 300 | 全站每日 AI 呼叫上限（不分供應商），用完降級成規則模式 |
| `CONSULT_RATE_LIMIT` / `CONSULT_HOURLY_LIMIT` | 10 / 30 | 每 IP 每分鐘、每小時的 AI 顧問上限 |
| `SCAN_RATE_LIMIT` | 3 | 每 IP 每分鐘掃描上限 |
| `TRUST_PROXY` | 0 | 反向代理後設 1，從 X-Forwarded-For 最右側取真實 IP |

| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 空 | Cloudflare Turnstile 人機驗證，secret 有值才啟用；掃描與 AI 顧問都要通過 |
| `API_KEYS` | 空 | 逗號分隔的金鑰，帶 `X-Api-Key` 可跳過 Turnstile（給 CI 用） |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 空 | 設了就把統計、每日額度、徽章快取每 60 秒存到 Upstash，重啟不歸零 |

前端 CSS 由 Tailwind 本地建置（`npm install` 後 `npm run css`），成品 `static/tailwind.css` 已進版控，部署端不需要 Node。改了 HTML 的 class 記得重新建置。
