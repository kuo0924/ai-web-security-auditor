tags: express, nginx, apache, wordpress, php, https, env_exposed, git_exposed, cookie_httponly, cookie_secure
# 自架伺服器（Express / Nginx / Apache / WordPress）

Express：
```js
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'], styleSrc: ["'self'", "'unsafe-inline'"] } },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
}));
app.use(express.static('public', { dotfiles: 'deny' }));
res.cookie('session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
```
強制 HTTPS（Express 在反向代理後面）：`app.set('trust proxy', 1)` 後檢查 `req.secure`，否則 301 到 https。

Nginx（server 區塊）：
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
location ~ /\.(?!well-known) { deny all; return 404; }   # 擋 .env .git 等所有點開頭路徑
```
80 port 的 server 區塊只放 `return 301 https://$host$request_uri;`。

Apache（.htaccess）：
```apache
Header always set X-Frame-Options "DENY"
Header always set X-Content-Type-Options "nosniff"
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
<FilesMatch "^\.">
  Require all denied
</FilesMatch>
RedirectMatch 404 /\.git
```
WordPress：網站網址改成 https://、安裝 Really Simple SSL 或在 .htaccess 加 301；標頭可用 HTTP Headers 外掛或 .htaccess。

.git 裸露的根因通常是直接在網站根目錄 `git clone`／`git pull` 部署。正確做法是 CI 建置後只把產物（dist/、build/）放到網站根目錄。
