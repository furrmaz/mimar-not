// Sunucu ayarları: yönetim panelinden değiştirilir, veritabanında (settings tablosu) saklanır.
// Panelde girilmemiş bir ayar için .env / ortam değişkeni kullanılır; panelden "kaldır" denince yine .env'e döner.
import type { DB } from "./db";

export interface SettingDef {
  key: string;
  /** Gizli değerler panele maskeli gönderilir, boş kaydedilirse değişmez */
  secret?: boolean;
}

export const SETTINGS: SettingDef[] = [
  { key: "ANTHROPIC_API_KEY", secret: true },
  { key: "CLAUDE_MODEL" },
  { key: "HF_API_KEY_ID" },
  { key: "HF_API_KEY_SECRET", secret: true },
  { key: "PAY_BANK" }, { key: "PAY_HOLDER" }, { key: "PAY_IBAN" },
  { key: "CONTACT_EMAIL" }, { key: "CONTACT_WHATSAPP" },
  { key: "COMPANY_NAME" }, { key: "COMPANY_ADDRESS" },
  { key: "TRIAL_DAYS" }, { key: "TRIAL_GENERATE" }, { key: "TRIAL_RENDER" },
  { key: "PLANS_JSON" },
  // Yönetici girişi (panelden parola değiştirilince yazılır; panele gönderilmez)
  { key: "ADMIN_USER" },
  { key: "ADMIN_PASSWORD_HASH", secret: true },
  // "1": .env'deki eski ADMIN_TOKEN yok sayılır (panelden parola belirlenince otomatik)
  { key: "ADMIN_TOKEN_OFF" },
];
const KNOWN = new Set(SETTINGS.map((s) => s.key));
const HIDDEN = new Set(["ADMIN_USER", "ADMIN_PASSWORD_HASH", "ADMIN_TOKEN_OFF"]);

export const mask = (v: string) => (!v ? "" : v.length <= 10 ? "•".repeat(v.length) : `${v.slice(0, 6)}…${v.slice(-4)}`);

export function openSettings(db: DB, env: (k: string) => string = (k) => (process.env[k] ?? "").trim()) {
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  let cache: Map<string, string> | null = null;
  const stored = () => {
    if (!cache) cache = new Map((db.prepare("SELECT key,value FROM settings").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    return cache;
  };
  return {
    /** Panel değeri, yoksa ortam değişkeni */
    get(key: string): string { return stored().get(key) ?? env(key); },
    source(key: string): "panel" | "env" | "none" { return stored().has(key) ? "panel" : env(key) ? "env" : "none"; },
    /** undefined: dokunma; null: panel değerini sil (.env'e dön); metin: kaydet */
    set(patch: Record<string, string | null | undefined>) {
      const now = Date.now();
      for (const [k, v] of Object.entries(patch)) {
        if (!KNOWN.has(k) || v === undefined) continue;
        if (v === null) db.prepare("DELETE FROM settings WHERE key=?").run(k);
        else db.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(k, String(v).trim(), now);
      }
      cache = null;
    },
    /** Panelde gösterilecek liste (gizliler maskeli) */
    view() {
      return SETTINGS.filter((d) => !HIDDEN.has(d.key)).map((d) => {
        const v = this.get(d.key);
        return { key: d.key, secret: Boolean(d.secret), value: d.secret ? mask(v) : v, set: Boolean(v), source: this.source(d.key) };
      });
    },
  };
}
export type Settings = ReturnType<typeof openSettings>;
