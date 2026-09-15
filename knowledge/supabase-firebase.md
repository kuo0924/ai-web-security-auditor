tags: supabase, firebase, lovable, bolt, v0, supabase_rls, firebase_rules, secret_leak
# Supabase / Firebase：前端可以有 key，但資料安全全靠規則

## Supabase
- `anon` key 與專案 URL 出現在前端是正常的；它的權限等於「未登入的訪客」，實際能做什麼由每張表的 Row Level Security（RLS）policy 決定。
- 最常見的事故：用 Lovable / Bolt 建表時沒開 RLS，或 policy 寫成 `using (true)`，結果任何人拿 anon key 打 `https://<project>.supabase.co/rest/v1/<table>` 就能整張表讀走或改掉。
- 檢查方式（SQL Editor）：
  ```sql
  select tablename, rowsecurity from pg_tables where schemaname = 'public';
  select tablename, policyname, cmd, qual from pg_policies where schemaname = 'public';
  ```
  `rowsecurity` 為 false 的表要 `alter table <t> enable row level security;`；`qual` 是 `true` 的 policy 要改成綁 `auth.uid()`，例如 `using (auth.uid() = user_id)`。
- `service_role` key 會繞過所有 RLS，等於資料庫 root。只能放在後端（Edge Function、Route Handler）的環境變數，永遠不能進前端或 git。本工具會解開前端出現的 JWT，看到 `role: service_role` 直接判定金鑰外洩。
- Storage bucket 也有 policy；公開 bucket 的檔案任何人都能列出。

## Firebase
- Web `apiKey` 本來就是公開的識別碼，藏起來沒有意義；真正的防線是 Security Rules 與 API key 限制。
- 測試模式的規則 `allow read, write: if true;` 或 `if request.time < timestamp.date(...)` 到期後會全部拒絕或一直全開，兩種都不對；改成 `allow read, write: if request.auth != null && request.auth.uid == userId;` 這類綁使用者的寫法。
- GCP 主控台 → APIs & Services → Credentials → 該 Web API Key：設定「HTTP referrer」限制只允許自己的網域，並把 API 限制縮到 Firebase 用到的幾個。
- 用 Firebase 模擬器或主控台的 Rules Playground 驗證：未登入者讀不到資料、登入者讀不到別人的資料。

## 給 AI 顧問的話
- 這兩項工具都不會去讀使用者的資料，只能從前端設定判斷「有用到」，所以措辭是「提醒你確認」而不是「你已經外洩」。
- 若 secret_leak 已經抓到 service_role key，優先處理它（先撤銷再改程式），RLS 稽核放第二。
