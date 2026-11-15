// Mimarın düzeltmelerinden öğrenme: yazılan düzeltme istekleri bu cihazda saklanır ve sonraki projelerde
// Claude'a "ofis tercihleri" olarak verilir. Model eğitimi yapılmaz; tercih listesi istemle birlikte gider.
const KEY = "mimar-not.lessons.v1";

export interface Lessons {
  /** Düzeltmelerden öğrenme açık mı */
  enabled: boolean;
  /** Mimarın elle yazdığı kalıcı tercihler */
  prefs: string;
  /** Yazılan düzeltme istekleri (en yeni sonda) */
  items: { text: string; at: number }[];
}

const EMPTY: Lessons = { enabled: true, prefs: "", items: [] };
const MAX = 40;

export function loadLessons(): Lessons {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Lessons> | null;
    if (!v) return { ...EMPTY };
    return { enabled: v.enabled !== false, prefs: String(v.prefs ?? ""), items: Array.isArray(v.items) ? v.items.filter((i) => i && typeof i.text === "string").slice(-MAX) : [] };
  } catch { return { ...EMPTY }; }
}

export function saveLessons(l: Lessons) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...l, items: l.items.slice(-MAX) })); } catch { /* yok say */ }
}

const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

/** Bir düzeltme isteğini kaydeder (aynısı varsa tarihi yenilenir). */
export function recordLesson(text: string) {
  const t = text.trim().slice(0, 300);
  if (t.length < 8) return;
  const l = loadLessons();
  if (!l.enabled) return;
  l.items = l.items.filter((i) => norm(i.text) !== norm(t));
  l.items.push({ text: t, at: Date.now() });
  saveLessons(l);
}

/** Claude'a gidecek ofis tercihleri metni (boşsa undefined). */
export function officePrefsText(): string | undefined {
  const l = loadLessons();
  const parts: string[] = [];
  if (l.prefs.trim()) parts.push(`Ofisin kalıcı tercihleri:\n${l.prefs.trim().slice(0, 2000)}`);
  if (l.enabled && l.items.length) parts.push(`Bu ofisin önceki projelerde istediği düzeltmeler (yinelenenler genel tercihtir):\n${l.items.slice(-15).map((i) => `- ${i.text}`).join("\n")}`);
  return parts.length ? parts.join("\n\n") : undefined;
}
