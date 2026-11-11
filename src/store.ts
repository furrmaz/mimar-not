import { callGenerate, ApiError, isNative } from "./platform";
import type { Program } from "./shared/schema";
import { desktop } from "./desktop";
import type { Brief } from "./brief";

export interface Project {
  id: string;
  title: string;
  notes: string;
  program: Program | null;
  updatedAt: number;
  /** Masaüstünde kaydedildiği .planhane dosyası (eski adı .mimarnot) */
  filePath?: string;
  /** Proje bilgileri formu */
  brief?: Brief;
  /** "Bu tarz olsun" referans görselleri (küçültülmüş JPEG data URL) */
  refImages?: string[];
  /** Geri almak için önceki programlar (en yeni sonda) */
  history?: { program: Program; label: string; at: number }[];
}

export interface ProjectFile {
  format: "mimarnot";
  version: 1;
  title: string;
  notes: string;
  program: Program | null;
  brief?: Brief;
  refImages?: string[];
  history?: Project["history"];
  savedAt: string;
}

export function toProjectFile(p: Project): string {
  const f: ProjectFile = { format: "mimarnot", version: 1, title: p.title, notes: p.notes, program: p.program, brief: p.brief, refImages: p.refImages, history: p.history, savedAt: new Date().toISOString() };
  return JSON.stringify(f, null, 2);
}

export function fromProjectFile(text: string): Project {
  const data = JSON.parse(text);
  // Düz bina programı JSON'u da kabul et
  if (data && data.floors && data.footprint) {
    return { ...newProject(data.clientName || data.projectName || "İçe aktarılan"), program: data as Program };
  }
  if (!data || data.format !== "mimarnot") throw new Error("Bu dosya bir Planhane projesi değil.");
  return { ...newProject(data.title || "Proje"), notes: data.notes ?? "", program: data.program ?? null, brief: data.brief, refImages: data.refImages, history: data.history };
}

const KEY = "mimar-not.projects.v1";

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Project[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveProjects(list: Project[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Depolama doluysa önce geçmişi kısalt, olmazsa sessizce geç
    try {
      localStorage.setItem(KEY, JSON.stringify(list.map((p) => ({ ...p, history: (p.history ?? []).slice(-3) }))));
    } catch { /* yok say */ }
  }
}

export function newProject(title = "Yeni görüşme"): Project {
  return { id: Math.random().toString(36).slice(2, 10), title, notes: "", program: null, updatedAt: Date.now() };
}

/** Son Claude yanıtı: uyarılar ve ham çıktı (hata bildirimi için indirilebilir) */
export const lastGen: { raw: unknown; warnings: string[]; at: number } = { raw: null, warnings: [], at: 0 };

export async function generateProgram(
  notes: string,
  previous: Program | null,
  extra: { revision?: string; brief?: Record<string, string>; images?: { mediaType: string; data: string }[] } = {},
  signal?: AbortSignal,
): Promise<Program> {
  try {
    const data = await callGenerate({ notes, previous: previous ?? undefined, ...extra }, signal);
    lastGen.raw = data.raw ?? null;
    lastGen.warnings = Array.isArray(data.warnings) ? data.warnings : [];
    lastGen.at = Date.now();
    return data.program;
  } catch (e) {
    if (e instanceof ApiError) { lastGen.raw = e.raw ?? null; lastGen.warnings = []; lastGen.at = Date.now(); }
    throw e;
  }
}

export function download(name: string, content: BlobPart | Uint8Array, type: string) {
  const blob = new Blob([content as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(s: string) {
  return (s || "proje")
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

let currentProject = "Proje";
export function setCurrentProject(name: string) {
  currentProject = name || "Proje";
}

const MIME: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", dxf: "application/dxf", glb: "model/gltf-binary", json: "application/json", pdf: "application/pdf", ifc: "application/x-step",
};

/** Çıktıyı kaydet: masaüstünde "Farklı kaydet" penceresi, tarayıcıda indirme. */
export async function saveOutput(baseName: string, ext: string, data: string | ArrayBuffer | Uint8Array | Blob) {
  if (isNative()) return shareNative(`${slug(currentProject)}-${slug(baseName)}.${ext}`, data);
  if (desktop) {
    const payload = data instanceof Blob ? await data.arrayBuffer() : data;
    return desktop.saveFile(currentProject, baseName, ext, payload);
  }
  download(`${slug(baseName)}.${ext}`, data, MIME[ext] ?? "application/octet-stream");
  return { saved: true };
}

/** Android: dosyayı uygulama klasörüne yazar ve paylaş menüsünü açar (Drive, WhatsApp, e-posta, Dosyalar…). */
async function shareNative(name: string, data: string | ArrayBuffer | Uint8Array | Blob) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  let written;
  if (typeof data === "string") {
    written = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, encoding: Encoding.UTF8 });
  } else {
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
    const b64: string = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1] ?? ""); fr.onerror = no; fr.readAsDataURL(blob); });
    written = await Filesystem.writeFile({ path: name, data: b64, directory: Directory.Cache });
  }
  try {
    await Share.share({ title: name, files: [written.uri], dialogTitle: "Kaydet ya da paylaş" });
  } catch (e) {
    if (!/cancel/i.test(String((e as Error)?.message))) throw e;
  }
  return { saved: true, path: name };
}
