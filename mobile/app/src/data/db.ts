/** 最小的資料庫介面：App 用 expo-sqlite，測試用 Node 內建的 node:sqlite，跑的是同一份 SQL。 */
export type SqlValue = string | number | null;

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  tx(fn: () => Promise<void>): Promise<void>;
}
