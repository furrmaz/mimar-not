// Planhane Bulut: SQLite veritabanı (Node'un yerleşik node:sqlite modülü; ek bağımlılık yok).
// Tek dosya: DATA_DIR/mimarnot.db. Yedek için bu dosyayı kopyalamak yeterli.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export interface UserRow {
  id: number;
  email: string;
  pass_hash: string;
  name: string;
  office: string;
  phone: string;
  created_at: number;
  /** Ücretli plan kimliği (plans.ts); null → deneme */
  plan: string | null;
  plan_start: number | null;
  plan_until: number | null;
  trial_until: number;
  disabled: number;
  note: string;
  last_seen: number | null;
}

export type DB = DatabaseSync;

export function openDB(dir: string): DB {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "mimarnot.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      office TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      plan TEXT,
      plan_start INTEGER,
      plan_until INTEGER,
      trial_until INTEGER NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      last_seen INTEGER,
      signup_ip TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      device TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,            -- 'generate' | 'render'
      at INTEGER NOT NULL,
      ok INTEGER NOT NULL,           -- 1: başarılı (kotadan düşer), 0: hata/iptal
      model TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS usage_user_at ON usage(user_id, at);
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      plan TEXT NOT NULL,
      months INTEGER NOT NULL,
      amount_try REAL NOT NULL DEFAULT 0,
      until INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}
