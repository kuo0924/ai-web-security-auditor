tags: general
# 上線前五問（給 Vibe Coding 產品的資安框架）

框架整理自 Gary Chen〈給非技術人員的資安教學，Vibe Coding 必學的基本功〉（2026-09）。本工具只能從外面看，等於只回答第五題；顧問給建議時，請把使用者的問題對回這五題，讓他知道「還有哪幾題要自己答」。

1. 哪些東西被偷會出大事？→ 先列清單：API 金鑰、金流 HashKey/HashIV、資料庫連線字串、使用者個資、上傳的檔案。清單上的東西只能存在後端與環境變數，前端 bundle、公開 repo、/.env 都不行。
2. 誰能碰哪些資料？→ 每一支 API 都在後端驗證「這個人是誰、能不能碰這筆」。前端傳來的 user id / role / price 一律不信；用 session 或 JWT 裡的身分重新查。Supabase 靠 RLS、Firebase 靠 Security Rules，不是靠前端不顯示按鈕。
3. 哪一段是你管不到的？→ 第三方套件、金流、AI API、OAuth。鎖版本並定期更新（npm audit / Dependabot）、金鑰限制來源與權限、看套件是否還在維護。
4. 哪些規則絕對不能被打破？→ 用一句話寫下來（「一般會員永遠讀不到別人的訂單」「免費方案不能呼叫付費模型」），寫成自動化測試，每次讓 AI 改完程式都跑。
5. 外面有哪些門是開著的？→ HTTPS 強制、安全標頭、Cookie 屬性、/.env 與 /.git 裸露、前端金鑰、source map。這是本工具做的事；修完重掃一次確認。

案例：What'Sub（2026-08，YouTuber 壹加壹用 AI 半年做出的字幕 SaaS）上線兩天就在 Threads 上被通報「一般會員能拿到正式環境的藍新金流 HashKey」。教訓不是「別用 AI 寫」，而是：金流與金鑰只能在後端、每個 API 都要做權限檢查、上線前先用讀得到程式碼的工具掃一遍。

Vibe coder 最常漏的三件事（外部掃描看不到，要提醒使用者自查）：
- 用 GET 改資料（/delete?id=…）→ 改 POST/PUT/DELETE 並加 CSRF 保護（SameSite=Lax 以上 + token）。
- 前端有做限制就以為安全 → 後端每一筆都要重驗。
- 第三方套件過時 → npm audit、pnpm audit、pip-audit。

讀得到程式碼的掃描（建議在修完本工具的項目之後做）：
- OpenAI Codex Security：在 Codex 裡輸入 /plugins 安裝「Codex Security」，開新對話後說「Run a Codex Security scan on this repository.」；報告在 report.md，每個 finding 有 severity、validated（已用 PoC 驗證，不是猜的）、evidence、remediation；修法是逐項「Fix and verify」。
- Claude Code：/security-review 會審查目前分支的變更。
- 兩者都會直接讀原始碼與環境設定，所以只在自己的專案上跑。
