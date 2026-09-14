tags: general
# 修復優先順序與驗證方法

優先順序（先止血再補強）：
1. 重大（critical）：金鑰外洩、/.env、/.git 裸露 → 先撤銷金鑰、擋掉檔案，再改程式。
2. 高（high）：未強制 HTTPS、缺 CSP。
3. 中／低：HSTS、X-Frame-Options、X-Content-Type-Options、Cookie 屬性。
4. 建議：Referrer-Policy、Permissions-Policy。

驗證方式（修完後自己確認）：
- 看標頭：`curl -sI https://你的網域/ | grep -i -E "strict-transport|content-security|x-frame|x-content-type|referrer|permissions"`
- 看轉址：`curl -sI http://你的網域/` 應回 301/308 且 Location 為 https://
- 看裸露：`curl -s -o /dev/null -w "%{http_code}" https://你的網域/.env` 應為 404 或 403

CSP 上線常見坑：
- Google Analytics / GTM、Stripe.js、reCAPTCHA、字型 CDN 都需要加白名單。
- Next.js / Nuxt 的 inline runtime script 需要 nonce 或 hash，別直接開 'unsafe-inline' 給 script-src。
- 先用 Content-Security-Policy-Report-Only 觀察一週再切正式。
