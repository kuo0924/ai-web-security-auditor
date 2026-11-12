// 設計 token 與資料庫 schema 的唯一來源都在 mobile/swipe_clean/replica/：
//   design/tokens.json → src/theme/tokens.json
//   schema.sql         → src/data/schema.gen.ts（第一個 migration）
// 改完來源檔後執行：npm run sync
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const replica = resolve(here, '../../swipe_clean/replica');
copyFileSync(resolve(replica, 'design/tokens.json'), resolve(here, '../src/theme/tokens.json'));
const sql = readFileSync(resolve(replica, 'schema.sql'), 'utf8');
writeFileSync(
  resolve(here, '../src/data/schema.gen.ts'),
  `// 由 scripts/sync-tokens.mjs 從 replica/schema.sql 產生，不要手改。\nexport const SCHEMA_V1 = ${JSON.stringify(sql)};\n`,
);
console.log('synced tokens.json and schema.gen.ts');
