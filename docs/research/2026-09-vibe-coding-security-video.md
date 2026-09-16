# 研究筆記：〈給非技術人員的資安教學，Vibe Coding 必學的基本功〉與 What'Sub 事件

整理日期：2026-09-17。目的：把影片的框架、What'Sub 事件的教訓、Codex Security 的用法，轉成本專案能直接用的東西（知識庫、檢查規則、頁面文案）。

## 1. 影片本身

- 來源：Gary Chen，YouTube `t9WA-BkLUps`，22:43，2026-09 上架，約 20 萬次觀看。
- 影片沒有開字幕／轉錄稿，YouTube 頁面也沒有 caption track，所以以下內容來自影片說明、章節時間戳、配套 Patreon 文章的公開摘要與相關報導，不是逐字稿。
- 章節：
  | 時間 | 主題 |
  |---|---|
  | 0:00 | What'Sub 事件與開場 |
  | 1:16 | 資安到底是什麼 |
  | 4:13 | 上線前的五個問題 |
  | 14:06 | Codex 掃描怎麼裝怎麼用 |
  | 16:16 | 報告裡的兩個高風險 |
  | 20:03 | 修補流程與結論 |
- 核心主張：功能會動不代表可以上線。資安在防的是「有價值的東西被不該碰的人碰到」，非技術人員也能用五個問題把它想清楚，再用讀得到程式碼的掃描工具補上自己看不出來的部分。

### 上線前五問（影片的框架，本專案的對應）

| # | 問題 | 本專案能做什麼 | 做不到、要提醒使用者自查 |
|---|---|---|---|
| 1 | 哪些東西被偷會出大事 | 前端金鑰、/.env、/.git、source map、Supabase service_role JWT、**新增：藍新／綠界 HashKey · HashIV** | 後端與資料庫裡的東西 |
| 2 | 誰能碰哪些資料 | Supabase RLS / Firebase Rules 提醒（只提醒，不驗證） | 每支 API 的後端權限檢查、越權 |
| 3 | 哪一段是你管不到的 | 過時前端函式庫、無 SRI 的第三方 script | 後端套件、金流與 AI API 的金鑰權限 |
| 4 | 哪些規則絕對不能被打破 | 無 | 寫成測試 |
| 5 | 外面有哪些門是開著的 | **本工具的全部**：HTTPS、標頭、Cookie、外洩檔案、DNS | 需要登入後才看得到的頁面（可用 paths 多頁掃描補一部分） |

結論：本工具只回答第五題，頁面與顧問都應該把這件事說清楚，而不是讓使用者以為 A 級＝安全。

## 2. What'Sub 事件（影片開場的案例）

- What'Sub：YouTuber 壹加壹用 AI 花約半年、約 20 萬元做的繁中 AI 字幕 SaaS（whatsub.equal2.app），2026-08-18 公開。
- 隨後在 Threads 上引發爭論：定價、可維護性、資安。其中有人通報「一般會員能存取到正式環境藍新金流（NewebPay）HashKey 相關資料」，細節以 email 提交。開發者（@lingjiepan）回應：團隊只有一個人，發現漏洞請寫信，會修會謝；並引用刑法 358／359／360 條與個資法警告不法存取。
- 本專案只看到社群通報與開發者回應，沒有官方事故報告，所以在知識庫裡寫成「被通報」而非「已證實」。
- 教訓（轉進知識庫與檢查規則）：
  1. 金流 HashKey／HashIV 與 Stripe secret 同級，只能在後端環境變數；前端出現就是 critical。→ `SECRET_PATTERNS` 新增 `tw_payment`。
  2. 「一般會員能拿到」代表 API 沒做權限檢查。外部掃描看不到，只能在五問裡提醒。
  3. 小團隊也要有通報管道（security.txt、信箱）與回應流程，本專案自己已有。

## 3. Codex Security（影片 14:06 起示範的工具）

- 安裝：Codex CLI 內輸入 `/plugins` → 搜尋 Codex Security → 安裝 → `/new`。桌面版在 Plugins 搜尋後側欄會出現 Security。
- 執行：一句 prompt「Run a Codex Security scan on this repository.」；桌面版 Security → Scans → + Scan。可選 Deep scan、可加「額外內容」描述攻擊面。
- 輸出：`report.md`（主入口）、`findings/<slug>/`（每個漏洞的細節與 PoC）、`hardening/`、`findings.json`、`scan-manifest.json`、`coverage.json`。
- 報告術語：severity（嚴重度）、validated（已用 PoC 驗證，不是猜測）、evidence（證據）、remediation（修法）、false positive（誤判）。
- 修補流程：開啟掃描 → Findings → 選一項 → Fix and verify → Export 到 GitHub / Linear / Jira。
- 也有開源 CLI：`npm install @openai/codex-security`，`codex-security login`、`codex-security scan <dir>`；CI 用 `OPENAI_API_KEY`。
- 對本專案的意義：它是「讀得到程式碼」的內部掃描，和本工具的外部被動掃描互補。頁面與知識庫都改成「先修本工具列出的，再跑 Codex Security 或 Claude Code /security-review」。

## 4. 相關的 Vibe Coding 資安檢查清單（補充來源：影響資安部落格）

外部掃描看不到、但 AI 生成程式最常漏的：
- CSRF：敏感操作要 token、Cookie 設 SameSite／HttpOnly／Secure、不用 GET 改資料。
- 越權（Broken Access Control）：後端每筆請求都驗身分與權限，不信前端資料；水平（看別人的）與垂直（變管理員）都要測。
- 第三方套件：鎖版本、`npm audit`／`pip-audit`、看維護狀態。
- 輸入驗證與輸出編碼：白名單、參數化查詢、HTML 編碼。
- 新手三問：有沒有驗證所有輸入？敏感操作有沒有權限檢查？有沒有用 GET 改資料、漏 CSRF？

## 5. 本次落地的變更

- `scanner.py`：`SECRET_PATTERNS` 新增藍新／綠界 HashKey · HashIV（16–32 碼、需像亂數），視同金鑰外洩 −30；掃描迴圈支援只取分組內容做遮罩。
- `knowledge/vibe-coding-launch.md`（tags: general）：五問框架、What'Sub 案例、三個常漏項目、Codex Security 與 Claude Code 的用法；知識庫預算 7000 → 12000 字元。
- `knowledge/secrets.md`：金流金鑰輪換步驟與正確架構。
- `index.html`：新增「掃描之外 · 上線前五問」區塊，明說本工具只回答第五題。
- 測試：`tests/test_launch_checklist.py`。

## 來源

- 影片：https://www.youtube.com/watch?v=t9WA-BkLUps
- 配套文章（Patreon，需登入）：https://www.patreon.com/GaryChen/posts/ni-gai-qing-li-167820602/
- What'Sub 介紹：https://www.bnext.com.tw/article/91942/whatsub-ai-subtitle-tool-guide
- 開發者回應（Threads）：https://www.threads.com/@lingjiepan/post/DcN2MbxGj6j/
- 事件評論：https://www.aiposthub.com/ai-taste-amplifier-whatsub-vibe-coding/ 、https://www.youtube.com/watch?v=FewgwNBAFfY
- Codex Security 文件：https://learn.chatgpt.com/docs/security/plugin 、https://github.com/openai/codex-security 、https://openai.com/index/codex-security-now-in-research-preview/
- Vibe Coding 資安地雷清單：https://cyber-security.effectstudio.com.tw/blog/3649
