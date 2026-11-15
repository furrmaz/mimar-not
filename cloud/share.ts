// Müşteri paylaşım bağlantısı: mimar bir projeyi salt okunur bağlantıyla müşterisine gönderir.
// Bağlantıyı bilen herkes projeyi görür (giriş gerekmez) ve yorum bırakabilir; mimar bağlantıyı istediği an kapatır.
// Saklanan veri: bina programı (JSON), ofis adı ve yorumlar. Görüşme notları ve görseller paylaşılmaz.
import crypto from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import type { DB, UserRow } from "./db";

export interface ShareOptions {
  db: DB;
  auth: (req: Request, res: Response, next: NextFunction) => void;
  /** Hesap başına açık bağlantı üst sınırı */
  maxShares?: number;
}

const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_COMMENTS = 200;

export function mountShare(app: Express, o: ShareOptions) {
  const { db } = o;
  db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      office TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      views INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id);
    CREATE TABLE IF NOT EXISTS share_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL REFERENCES shares(token) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      at INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS share_comments_token ON share_comments(token);
  `);
  type Authed = Request & { user: UserRow };
  const userOf = (req: Request) => (req as Authed).user;
  const maxShares = o.maxShares ?? 100;
  const row = (token: string) => db.prepare("SELECT * FROM shares WHERE token=?").get(token) as { token: string; user_id: number; project_id: string; title: string; office: string; data: string; created_at: number; updated_at: number; views: number } | undefined;
  const comments = (token: string) => db.prepare("SELECT id, name, text, at FROM share_comments WHERE token=? ORDER BY id").all(token) as { id: number; name: string; text: string; at: number }[];
  const validToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{16,40}$/.test(t);

  // yorum hız sınırı: IP başına 10 dakikada 10 yorum
  const hits = new Map<string, number[]>();
  const limited = (ip: string) => {
    const now = Date.now();
    const list = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
    list.push(now);
    hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return list.length > 10;
  };

  /** Bağlantı oluştur ya da (aynı proje için varsa) içeriğini güncelle. */
  app.post("/api/share", o.auth, (req, res) => {
    const u = userOf(req);
    if (u.disabled) { res.status(403).json({ error: "Hesabınız kapatılmış.", code: "disabled" }); return; }
    const b = (req.body ?? {}) as { program?: unknown; title?: unknown; projectId?: unknown };
    const p = b.program as { floors?: unknown; footprint?: unknown; projectName?: unknown } | undefined;
    if (!p || typeof p !== "object" || !Array.isArray(p.floors) || !p.footprint) { res.status(400).json({ error: "Paylaşılacak proje bulunamadı. Önce projeyi üretin." }); return; }
    const data = JSON.stringify(p);
    if (data.length > MAX_BYTES) { res.status(413).json({ error: "Proje paylaşmak için çok büyük." }); return; }
    const title = String(b.title ?? p.projectName ?? "Proje").trim().slice(0, 160) || "Proje";
    const projectId = String(b.projectId ?? "").slice(0, 80);
    const now = Date.now();
    const old = projectId ? db.prepare("SELECT token FROM shares WHERE user_id=? AND project_id=?").get(u.id, projectId) as { token: string } | undefined : undefined;
    if (old) {
      db.prepare("UPDATE shares SET title=?, office=?, data=?, updated_at=? WHERE token=?").run(title, u.office || u.name, data, now, old.token);
      res.json({ token: old.token, updated: true });
      return;
    }
    const n = (db.prepare("SELECT COUNT(*) AS n FROM shares WHERE user_id=?").get(u.id) as { n: number }).n;
    if (n >= maxShares) { res.status(400).json({ error: `En çok ${maxShares} paylaşım bağlantısı açık olabilir. Eskilerini kapatın.` }); return; }
    const token = crypto.randomBytes(15).toString("base64url");
    db.prepare("INSERT INTO shares (token,user_id,project_id,title,office,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(token, u.id, projectId, title, u.office || u.name, data, now, now);
    res.json({ token, updated: false });
  });

  app.get("/api/share", o.auth, (req, res) => {
    const u = userOf(req);
    const rows = db.prepare(`SELECT s.token, s.project_id AS projectId, s.title, s.created_at AS createdAt, s.updated_at AS updatedAt, s.views,
      (SELECT COUNT(*) FROM share_comments c WHERE c.token = s.token) AS comments,
      (SELECT MAX(at) FROM share_comments c WHERE c.token = s.token) AS lastCommentAt
      FROM shares s WHERE s.user_id=? ORDER BY s.updated_at DESC`).all(u.id);
    res.json({ shares: rows });
  });

  app.get("/api/share/:token/comments", o.auth, (req, res) => {
    const s = validToken(req.params.token) ? row(req.params.token) : undefined;
    if (!s || s.user_id !== userOf(req).id) { res.status(404).json({ error: "Bağlantı bulunamadı." }); return; }
    res.json({ comments: comments(s.token) });
  });

  app.delete("/api/share/:token", o.auth, (req, res) => {
    const s = validToken(req.params.token) ? row(req.params.token) : undefined;
    if (!s || s.user_id !== userOf(req).id) { res.status(404).json({ error: "Bağlantı bulunamadı." }); return; }
    db.prepare("DELETE FROM share_comments WHERE token=?").run(s.token);
    db.prepare("DELETE FROM shares WHERE token=?").run(s.token);
    res.json({ ok: true });
  });

  // ---------- herkese açık (bağlantıyı bilen) ----------
  app.get("/api/public/share/:token", (req, res) => {
    const s = validToken(req.params.token) ? row(req.params.token) : undefined;
    if (!s) { res.status(404).json({ error: "Bu paylaşım bağlantısı kapatılmış ya da hatalı." }); return; }
    db.prepare("UPDATE shares SET views = views + 1 WHERE token=?").run(s.token);
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.json({ title: s.title, office: s.office, updatedAt: s.updated_at, program: JSON.parse(s.data), comments: comments(s.token) });
  });

  app.post("/api/public/share/:token/comments", (req, res) => {
    const s = validToken(req.params.token) ? row(req.params.token) : undefined;
    if (!s) { res.status(404).json({ error: "Bu paylaşım bağlantısı kapatılmış ya da hatalı." }); return; }
    const ip = req.ip ?? "";
    if (limited(ip)) { res.status(429).json({ error: "Çok sık yorum gönderdiniz, birkaç dakika sonra deneyin." }); return; }
    const b = (req.body ?? {}) as { name?: unknown; text?: unknown };
    const text = String(b.text ?? "").trim().slice(0, 2000);
    const name = String(b.name ?? "").trim().slice(0, 80);
    if (text.length < 2) { res.status(400).json({ error: "Yorum boş olamaz." }); return; }
    const n = (db.prepare("SELECT COUNT(*) AS n FROM share_comments WHERE token=?").get(s.token) as { n: number }).n;
    if (n >= MAX_COMMENTS) { res.status(400).json({ error: "Bu bağlantıda yorum sınırına ulaşıldı. Mimarınızla doğrudan iletişime geçin." }); return; }
    db.prepare("INSERT INTO share_comments (token,name,text,at,ip) VALUES (?,?,?,?,?)").run(s.token, name, text, Date.now(), ip);
    res.json({ comments: comments(s.token) });
  });
}
