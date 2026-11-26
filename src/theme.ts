/** Arayüz teması: cihazda saklanır, <html data-theme> ile uygulanır. Paftalar/DXF etkilenmez. */
export type ThemeId = "terrakota" | "aydinger" | "zeytin" | "gece" | "ozalit";
export type ThemeChoice = ThemeId | "sistem";

export const THEMES: { id: ThemeId; name: string; note: string; dark: boolean; colors: [string, string, string, string] }[] = [
  { id: "terrakota", name: "Terrakota", note: "Sıcak beyaz, kiremit vurgu", dark: false, colors: ["#f5f4f1", "#ffffff", "#1d1d1f", "#b5532e"] },
  { id: "aydinger", name: "Aydınger", note: "Teknik kâğıt, lacivert", dark: false, colors: ["#f2f4f6", "#ffffff", "#18212b", "#1f4f7a"] },
  { id: "zeytin", name: "Zeytin", note: "Adaçayı, zeytin yeşili", dark: false, colors: ["#f1f2ec", "#fbfbf8", "#20231c", "#56703c"] },
  { id: "gece", name: "Gece", note: "Grafit koyu, kehribar", dark: true, colors: ["#151618", "#1d1f22", "#ebebea", "#e3a04b"] },
  { id: "ozalit", name: "Ozalit", note: "Koyu lacivert, ozalit mavisi", dark: true, colors: ["#0e2540", "#12304f", "#e4eef7", "#5cc6e4"] },
];

const KEY = "mimar-not.theme";
const IDS = new Set<string>(["sistem", ...THEMES.map((t) => t.id)]);
const darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function loadTheme(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); if (v && IDS.has(v)) return v as ThemeChoice; } catch { /* yok say */ }
  return "terrakota";
}

function resolve(c: ThemeChoice): ThemeId {
  return c === "sistem" ? (darkQuery?.matches ? "gece" : "terrakota") : c;
}

export function applyTheme(c: ThemeChoice = loadTheme()) {
  const id = resolve(c);
  const root = document.documentElement;
  if (id === "terrakota") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", id);
  const t = THEMES.find((x) => x.id === id)!;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
  meta.content = t.colors[1];
}

export function saveTheme(c: ThemeChoice) {
  try { localStorage.setItem(KEY, c); } catch { /* yok say */ }
  applyTheme(c);
}

/** Açılışta bir kez: kayıtlı temayı uygular, "Sistemle aynı" seçiliyse sistem değişimini izler. */
export function initTheme() {
  applyTheme();
  darkQuery?.addEventListener?.("change", () => { if (loadTheme() === "sistem") applyTheme("sistem"); });
}
