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

## CSP 的 script-src 開了 'unsafe-inline'：形同沒防 XSS

即使 CSP 項目「通過」，只要 passed 的備註寫著「script-src 允許 'unsafe-inline'」，就要主動指出：這樣的 CSP 對 XSS 幾乎沒有防護力，攻擊者注入的 inline script 一樣會執行。Next.js 的 hydration script 本身是 inline 的，很多人為了讓它過就開 'unsafe-inline'，正確做法是 nonce：

1. `middleware.ts` 每個請求產生 nonce，同時寫進 CSP 標頭與 `x-nonce` 請求標頭。
2. Next.js 會自動把 nonce 加到它自己的 inline script；自己加的 `<Script>` 用 `headers().get('x-nonce')` 讀出後傳 `nonce` 屬性。
3. 用了 nonce 的路由會變成 dynamic rendering（無法純靜態輸出）；純靜態頁可改用 hash 白名單（`'sha256-…'`）。
4. 先用 `Content-Security-Policy-Report-Only` 觀察，console 沒有 violation 再切正式。
5. `style-src` 的 'unsafe-inline' 風險低得多（CSS 注入不能執行程式），可以暫時保留。

```ts
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://你的後端網域",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico).*)' }],
}
```

改完後 next.config.js 的 headers() 裡不要再重複設 Content-Security-Policy，否則兩個標頭會互相衝突。
