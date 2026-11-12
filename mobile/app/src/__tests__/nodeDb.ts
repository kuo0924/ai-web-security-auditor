// 測試用：Node 內建的 SQLite，跑跟 App 一樣的 SQL。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite');
import type { Db, SqlValue } from '../data/db';

export function nodeDb(): Db & { raw: any } {
  const db = new DatabaseSync(':memory:');
  return {
    raw: db,
    exec: async (sql: string) => db.exec(sql),
    run: async (sql: string, params: SqlValue[] = []) => {
      db.prepare(sql).run(...params);
    },
    all: async <T,>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    tx: async (fn: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
