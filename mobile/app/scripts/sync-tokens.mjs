// 設計 token 的唯一來源是 replica/design/tokens.json；這支腳本把它複製進 App。
// 改色流程：改 replica/design/tokens.json → python3 -I check_contrast.py → npm run tokens
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../swipe_clean/replica/design/tokens.json');
const dst = resolve(here, '../src/theme/tokens.json');
copyFileSync(src, dst);
console.log(`tokens synced: ${src} -> ${dst}`);
