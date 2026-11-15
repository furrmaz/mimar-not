// Yönetim paneli girişi: kullanıcı adı + parola (scrypt özeti), imzalı oturum çerezi.
// Özet biçimi "scrypt:tuz:özet" (iki nokta üst üste): .env içinde "$" Docker Compose'da değişken sanılır.
import crypto from "node:crypto";

const P = { N: 16384, r: 8, p: 1 } as const;

export function hashAdminPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32, P);
  return `scrypt:${salt.toString("base64")}:${h.toString("base64")}`;
}

export function checkAdminPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split(/[:$]/);
  if (alg !== "scrypt" || !s || !h) return false;
  const want = Buffer.from(h, "base64");
  if (!want.length) return false;
  const got = crypto.scryptSync(pw, Buffer.from(s, "base64"), want.length, P);
  return crypto.timingSafeEqual(want, got);
}

export const validAdminHash = (h: string) => /^scrypt[:$][A-Za-z0-9+/=]+[:$][A-Za-z0-9+/=]+$/.test(h);

export const ADMIN_COOKIE = "pn_admin";
export const ADMIN_SESSION_MS = 12 * 3_600_000;

/** Oturum belirteci: "kullanıcı.bitiş.imza". Anahtar parola özetinden türer: parola değişince tüm oturumlar düşer. */
export function adminSessions(secretMaterial: string) {
  const key = crypto.createHash("sha256").update(`planhane-admin-session|${secretMaterial}`).digest();
  const sign = (body: string) => crypto.createHmac("sha256", key).update(body).digest("base64url");
  return {
    issue(user: string, now = Date.now()): string {
      const body = `${Buffer.from(user).toString("base64url")}.${now + ADMIN_SESSION_MS}`;
      return `${body}.${sign(body)}`;
    },
    verify(token: string, now = Date.now()): string | null {
      const m = /^([A-Za-z0-9_-]*)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
      if (!m) return null;
      const body = `${m[1]}.${m[2]}`;
      const a = Buffer.from(sign(body)), b = Buffer.from(m[3]);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      if (Number(m[2]) < now) return null;
      return Buffer.from(m[1], "base64url").toString();
    },
  };
}

export function readCookie(header: string | undefined, name: string): string {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}
