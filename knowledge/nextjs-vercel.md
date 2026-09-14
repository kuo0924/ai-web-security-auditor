tags: nextjs, vercel, csp, hsts, x_frame_options, x_content_type_options, referrer_policy, permissions_policy
# Next.js / Vercel 安全標頭設定

next.config.js 範本（App Router 與 Pages Router 通用）：
```js
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];
module.exports = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};
```
- 使用 next.config.mjs 時改成 `export default { async headers() {...} }`。
- CSP 若需要 nonce：在 middleware.ts 用 `crypto.randomUUID()` 產生 nonce，寫進 `Content-Security-Policy` 與 `x-nonce` 請求標頭，layout 中用 `headers().get('x-nonce')` 傳給 `<Script nonce>`；同時要把該路由設為 dynamic。
- Vercel 自動提供 HTTPS 與 HTTP→HTTPS 轉址；若自訂網域仍可用 http 瀏覽，到 Vercel 專案 Settings → Domains 檢查。
- 純靜態專案（沒有 next.config.js）可改用 vercel.json：
```json
{ "headers": [{ "source": "/(.*)", "headers": [{ "key": "X-Content-Type-Options", "value": "nosniff" }] }] }
```
- 金鑰：只有 `NEXT_PUBLIC_` 開頭的變數會被打包到瀏覽器。OpenAI、Stripe secret、Supabase service_role 這類金鑰一律放在沒有前綴的變數，並只在 Route Handler（app/api/*/route.ts）或 Server Action 中讀取。
