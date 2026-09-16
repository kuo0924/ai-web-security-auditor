tags: secret_leak, env_exposed, git_exposed, supabase, firebase, openai, stripe, aws, newebpay, ecpay, tw_payment
# 金鑰外洩處理 SOP

順序絕對不能反：先撤銷，再改程式，最後清歷史。
1. 撤銷／輪換：OpenAI 在 platform.openai.com/api-keys；Stripe 在 Dashboard → Developers → API keys（sk_live 外洩要立即 roll）；AWS 在 IAM → Users → Security credentials；Google 在 GCP → APIs & Services → Credentials。
2. 檢查帳單與使用紀錄，確認是否已被盜用。
3. 找出打包進前端的原因：通常是把 secret 放進 NEXT_PUBLIC_ / VITE_ 變數，或直接寫死在程式碼。
4. 把呼叫搬到後端／Serverless Function，前端只呼叫自己的 API，並在後端做速率限制與輸入驗證。
5. 清 git 歷史：`git filter-repo --replace-text` 或 BFG，之後 force push，並通知協作者重新 clone。
6. 預防：加 `.gitignore`、`gitleaks` pre-commit hook、GitHub secret scanning。

哪些 key 放前端是正常的（但要限制）：
- Google Maps / Firebase Web API Key：本來就會出現在前端，但要在 GCP 主控台設定「HTTP referrer 限制」與「API 限制」，Firebase 要靠 Security Rules 保護資料。
- Supabase anon key：允許放前端，安全性完全靠 Row Level Security；service_role key 絕對不能放前端。
- Stripe publishable key（pk_live_）：允許；secret key（sk_live_）絕對不行。

.env 裸露的典型原因：
- 把 .env 放進 public/ 或靜態輸出目錄。
- PHP / 傳統主機把專案根目錄直接當網站根目錄，且沒有擋點開頭檔案。
- Docker image 把 .env COPY 進去又用 nginx 直接 serve 整個目錄。

台灣金流（藍新 NewebPay / 綠界 ECPay）的 HashKey / HashIV 外洩：
- 這兩把能偽造付款結果通知、解密交易資料，嚴重度等同 Stripe secret key。藍新：商店後台 → 商店資料 → API 串接金鑰重新產生；綠界：廠商後台 → 系統開發管理 → 系統介接設定，重新申請。
- 正確架構：前端只把訂單送到自己的後端，由後端用環境變數裡的 HashKey/HashIV 加密（AES）並轉交金流；回呼（ReturnURL / NotifyURL）在後端驗證 CheckValue / TradeSha 後才更新訂單狀態。
- 修完後用「一般會員帳號」實際打一次原本外洩的 API，確認拿不到設定資料，再重掃。
