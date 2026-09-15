# 部署到公網

**正式網址：https://ai-web-security-auditor.onrender.com**（Render 服務 ID `srv-dakkrtifngtc73apthi0`，2026-09-15 上線，Blueprint 已綁定 GitHub main 分支，push 即自動部署）

整個產品是一個 FastAPI 服務（後端 API + 靜態的 index.html），放 Render 免費方案就夠，從 GitHub 自動部署。

```
使用者瀏覽器
    │  https
    ▼
Render（FastAPI，含前端頁面）──▶ 目標網站（被動 GET）
                              └─▶ Gemini API（AI 顧問）
```

---

## 步驟一：程式碼在 GitHub

repo：`kuo0924/ai-web-security-auditor`（private）。之後改程式只要：

```bash
git add -A
git commit -m "說明"
git push
```

Render 會自動重新部署。推之前確認金鑰沒進版控：

```bash
git log -p --all | grep -E "AQ\.|AIza|sk-[A-Za-z0-9]{30}"
```

沒有輸出才算安全。`.env` 已在 `.gitignore`。

---

## 步驟二：在 Render 建立服務

1. 到 [render.com](https://render.com) 用 GitHub 帳號登入
2. **New → Blueprint**，選 `ai-web-security-auditor` 這個 repo。它會讀根目錄的 `render.yaml` 自動建立服務
3. 系統會要求填兩個標了 `sync: false` 的環境變數：

   | 變數 | 值 |
   |---|---|
   | `ANTHROPIC_API_KEY` | 你的 Claude 金鑰（`sk-ant-` 開頭，在 console.anthropic.com → API Keys 建立） |
   | `OPENAI_API_KEY` | 你的 Gemini 金鑰（`AQ.` 開頭，和本機 `.env` 裡那把一樣），當 Claude 的備援 |

   其他變數（模型、effort、每日金額上限、限流數字）都已寫在 `render.yaml`，不用動。
4. 按 Apply，等 2～3 分鐘建置完成
5. 拿到網址（目前是 `https://ai-web-security-auditor.onrender.com`）
6. 開 `https://<你的網址>/api/health` 確認：
   - `"llm_providers_order": ["anthropic", "openai"]`
   - `"llm_model": "claude-sonnet-5"`
   - `"llm_budget": {"claude_usd_today": 0, "claude_usd_limit": 2, ...}`
7. 開首頁掃一次 `httpbin.org`，看 AI 顧問區有沒有正常生成

---

## 步驟三（建議）：讓它真的「隨時」都在

Render 免費方案在 15 分鐘沒人用之後會休眠，下一個人打開要等 30～60 秒冷啟動。
免費解法是讓外部服務每 10 分鐘敲一下：

1. 到 [uptimerobot.com](https://uptimerobot.com) 註冊免費帳號（或 [cron-job.org](https://cron-job.org)）
2. 新增 HTTP 監控，網址填 `https://<你的網址>/api/health`，間隔 10 分鐘
3. 順便得到當機通知

免費方案每月 750 小時實例時數，一個服務全月開著是 720 小時，剛好夠。

不想靠這招的話，Render 的 Starter 方案（每月 7 美元）不會休眠。

---

## 上線後要知道的事

### 額度與費用

- AI 顧問以 Claude Sonnet 5 為主：按用量計費，沒人用就是 0 元。每次顧問呼叫約 0.02～0.03 美元，系統提示詞有開 prompt caching，同一天內重複的部分只收一成價。
- `LLM_DAILY_BUDGET_USD=2`：Claude 當天估算費用達 2 美元就自動改用 Gemini，隔天 UTC 0 點恢復。這是保險絲，不是每天固定扣的錢。估算用 `/api/health` 的 `claude_usd_today` 看，實際帳單以 Anthropic Console 為準。
- Gemini 是備援：Claude 額度用完、429、5xx 或拒答時接手。Gemini 金鑰和排班表辨識專案共用同一把、同一份額度；模型清單會在 429 / 5xx 時自動換下一個。
- `LLM_DAILY_BUDGET=300`：不分供應商，全站每天最多 300 次 AI 呼叫，用完降級成規則引擎的靜態指引。前端會顯示「AI 顧問目前無法使用」，掃描本身不受影響。
- 想調數字：Render 後台 → 該服務 → Environment，改完會自動重啟。`ANTHROPIC_EFFORT` 從 medium 降到 low 可再省，升到 high 更仔細但更貴。

### 濫用與法律責任

- 工具只送被動 GET，但它現在是**你**在對外提供服務。有人拿它去掃不該掃的網站，被掃方看到的來源 IP 是 Render 的。
- 已有的保護：授權勾選、每 IP 每分鐘 3 次掃描、內網位址拒絕、每次掃描最多約 12 個請求（外加兩次公開 DNS 查詢）。
- 每次掃描的 log 都有「來源 IP → 目標網域」，在 Render 後台的 Logs 分頁可查；被投訴時拿得出紀錄。
- 建議在首頁底部加上聯絡方式（Email），讓被掃方有管道找你。

### 有多少人在用

- 給人看的頁面：`https://ai-web-security-auditor.onrender.com/stats`（每 60 秒自動更新）。
- 原始 JSON：`https://ai-web-security-auditor.onrender.com/api/stats`：今日與啟動以來的掃描數、AI 顧問數、不重複來源 IP、A/B/C/F 分布、最常見的平台、最近 7 天每日數。存在記憶體，重新部署會歸零；UptimeRobot 的探測不會被算進去。
- 想不公開這個數字，在 Render 環境變數加 `STATS_TOKEN=隨便一串`，之後要帶 `?token=那串` 才看得到。
- Render 後台 → Logs 搜 `scan ` 可以看到每一筆「來源 IP → 目標網域」，免費方案保留 7 天。
- **訪客統計（Cloudflare Web Analytics，免費、無 cookie、不用改 DNS）**：到 dash.cloudflare.com 註冊 → 左側 Analytics & Logs → Web Analytics → Add a site → 填 `ai-web-security-auditor.onrender.com` → 它會給一段 `<script … data-cf-beacon='{"token": "…"}'>`，把 token 的值填到 Render 環境變數 `CF_BEACON_TOKEN`，儲存後自動重新部署，首頁與 /stats 就會載入 beacon。token 是公開的站台識別碼，會出現在 HTML 裡，不是機密。之後在 Cloudflare 的 Web Analytics 頁看訪客數、來源國家、瀏覽頁面、載入速度。

### 選配：三個免費服務讓它更耐用

都是到 Render 後台 → 服務 → Environment 加變數，儲存後自動重新部署。沒設就維持原本行為。

| 想要什麼 | 去哪裡拿 | 填哪些變數 |
|---|---|---|
| 擋腳本刷 AI 額度（Turnstile） | dash.cloudflare.com → Turnstile → Add widget，Hostname 填 `ai-web-security-auditor.onrender.com`，Widget mode 選 Managed 或 Invisible | `TURNSTILE_SITE_KEY`（公開，可放 render.yaml）、`TURNSTILE_SECRET_KEY`（機密，只放 Render） |
| 給 CI 或腳本呼叫 | 自己產一串隨機長字串，例如 PowerShell `[guid]::NewGuid().ToString("N")` | `API_KEYS`（多把用逗號分隔） |
| 統計、額度、徽章重啟不歸零 | upstash.com → Create Database（Redis，Free，選離 Render Oregon 近的區域）→ REST API 分頁 | `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` |

設好後 `/api/health` 會顯示 `"turnstile_site_key"` 與 `"persistence": "upstash"`。

### 運維

- **在 Render 貼金鑰時**：只貼金鑰本身，別貼到指令文字；貼完到 `https://<網址>/api/health` 看 `key_lengths`，Claude 金鑰應為 108、Gemini 為 53。貼錯時到 Environment → Edit 重貼，Save 後會自動重新部署。
- **限流來源 IP**：Render 的 X-Forwarded-For 尾端是內部私有 IP，程式改用 CF-Connecting-IP／最右側公開 IP；用 `/api/whoami` 可確認自己被辨識成哪個 IP。

- 看 log：Render 後台 → 服務 → Logs。中文 log 已改 UTF-8 不會亂碼。
- 改知識庫：編輯 `knowledge/*.md` 後 push，會自動重新部署；或對線上服務 `POST /api/knowledge/reload`。
- 限流與每日額度存在記憶體，服務重啟就歸零；免費方案休眠喚醒也算重啟。這對單一服務、小流量沒問題，流量大了再換 Redis。
- 自訂網域：Render 後台 → Settings → Custom Domains，加 CNAME 即可，HTTPS 自動配。

---

## 本機與線上的差別

| | 本機 | Render |
|---|---|---|
| 設定來源 | `.env` | Render 後台環境變數（`render.yaml` + 手動填的金鑰） |
| 網址 | http://127.0.0.1:8000 | https://xxx.onrender.com |
| TRUST_PROXY | 0 | 1 |
| 休眠 | 無 | 免費方案 15 分鐘無人用即休眠 |
