import * as SQLite from 'expo-sqlite';
import type { Db, SqlValue } from './db';

export async function openExpoDb(name = 'photo-swipe.db'): Promise<Db> {
  const db = await SQLite.openDatabaseAsync(name);
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      await db.runAsync(sql, params);
    },
    all: <T,>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    tx: (fn) => db.withTransactionAsync(fn),
  };
}
