tags: netlify, github-pages, cloudflare, vite, react, vue, sveltekit, nuxt, angular, lovable, v0, bolt
# 靜態託管與純前端框架（Vite / React / Vue / Nuxt / SvelteKit）

Netlify：在 `public/_headers`（或建置輸出目錄）加入
```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'
```
或在 netlify.toml 使用 `[[headers]] for = "/*"` 區塊。

Cloudflare Pages：同樣使用 `_headers` 檔案；Cloudflare 代理的網站也可在 Rules → Transform Rules 加回應標頭，HSTS 可直接在 SSL/TLS → Edge Certificates 開啟。

GitHub Pages：無法自訂 HTTP 標頭。可以用 `<meta http-equiv="Content-Security-Policy" content="...">` 設 CSP（但 frame-ancestors 在 meta 無效），HSTS/X-Frame-Options 無解，需要這些標頭時建議改用 Cloudflare Pages 或 Netlify。

Nuxt：nuxt.config.ts 的 `routeRules: { '/**': { headers: { 'X-Frame-Options': 'DENY' } } }`，或安裝 `nuxt-security` 模組一次補齊。
SvelteKit：src/hooks.server.ts 的 `handle` 中 `response.headers.set(...)`。

金鑰：
- Vite 專案只有 `VITE_` 前綴的變數會進瀏覽器；Nuxt 是 `runtimeConfig.public`；SvelteKit 是 `PUBLIC_` 前綴。
- 純前端專案沒有後端可藏金鑰，需要呼叫 OpenAI/Stripe 這類服務時，請加一層 Serverless Function（Vercel api/、Netlify functions、Cloudflare Workers、Supabase Edge Functions），金鑰只放在 Function 的環境變數。
- Lovable / v0 / Bolt 產生的專案通常是 Vite + React + Supabase：anon key 放前端是設計上允許的，但一定要開啟 Row Level Security（RLS）並為每張表寫 policy，service_role key 永遠不能出現在前端。
