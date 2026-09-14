# AI 網站安全體檢儀 + 智慧資安顧問

**AI-Powered Passive Web Security Auditor**
給用 Cursor / v0 / Bolt / Lovable 搭站、但沒有資安背景的開發者與學生。輸入網址，30 秒內拿到評分、白話風險解讀，以及可以直接貼給 AI 的修復 Prompt。

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

已在 Python 3.14 + FastAPI 0.141 驗證：62 項離線單元測試（SSRF 判定、金鑰正則、SPA fallback、計分）與真實網站掃描皆通過。

## 架構

| 層 | 位置 | 說明 |
|---|---|---|
| 硬規則檢測層 | `main.py` §3–4 | 純被動 GET、確定性計分、毫秒級，不用 LLM |
| AI 顧問層 | `main.py` §6 | 把檢測 JSON 交給 OpenAI 或 Claude，產出白話診斷與架構專屬修復 Prompt，支援追問 |
| 知識庫層 | `knowledge/` | 標籤式檢索（RAG 預留介面）+ few-shot 範例，改 Markdown 就能讓建議越調越準 |
| 前端 | `index.html` | 單頁 Tailwind 深色介面，分數儀表板、風險卡片、一鍵複製 Prompt、AI 追問 |

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
| `/.env` 回 200 且內容像 env 檔 | 30 |
| `/.git/config` 回 200 且內容像 git 設定 | 20 |
| Referrer-Policy、Permissions-Policy | 0（僅建議） |

評等：85 分以上 A、70–84 B、50–69 C、50 以下 F。
`/.env` 與 `/.git/config` 會辨識 SPA 的 fallback 頁面（回 200 但內容是 HTML），不會誤判。

## 法律邊界與防護

- **只做被動檢查**：每次體檢最多送出約 6–9 個一般瀏覽器也會送的 GET 請求（首頁、http 轉址探測、站內 JS、`/.env`、`/.git/config`）。沒有注入、爆破、port 掃描。
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
| `GET` | `/api/health` | 目前 LLM 供應商、知識庫文件數 |
| `POST` | `/api/knowledge/reload` | 編輯 `knowledge/` 後不重啟即生效 |

## 讓建議越調越準（不重訓模型）

1. 在 `knowledge/` 新增或修改 Markdown，第一行寫 `tags: nextjs, csp, ...`。標籤會和偵測到的技術棧、缺失項目 id 做比對，命中的文件會注入 System Prompt。
2. 在 `knowledge/fewshot.json` 放入你滿意的輸入／輸出範例，模型會模仿其風格。
3. 呼叫 `POST /api/knowledge/reload`。
4. 要升級成向量 RAG，只需改寫 `KnowledgeBase.retrieve()`。

## 部署到公網

完整步驟見 [DEPLOY.md](DEPLOY.md)。摘要：repo 在 GitHub，Render 讀 `render.yaml` 自動建服務，只需在 Render 後台填 `OPENAI_API_KEY`。

公開服務用的保護（都可用環境變數調整）：

| 變數 | 預設 | 作用 |
|---|---|---|
| `OPENAI_MODEL` | 逗號分隔清單 | 429 / 5xx / 逾時時依序換下一個模型 |
| `LLM_DAILY_BUDGET` | 300 | 全站每日 AI 呼叫上限，用完降級成規則模式 |
| `CONSULT_RATE_LIMIT` / `CONSULT_HOURLY_LIMIT` | 10 / 30 | 每 IP 每分鐘、每小時的 AI 顧問上限 |
| `SCAN_RATE_LIMIT` | 3 | 每 IP 每分鐘掃描上限 |
| `TRUST_PROXY` | 0 | 反向代理後設 1，從 X-Forwarded-For 最右側取真實 IP |

正式環境可再把 Tailwind CDN 換成本地建置的 CSS；多進程部署時限流要改用 Redis。
