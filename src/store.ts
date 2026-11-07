import type { Program } from "./shared/schema";
import { desktop } from "./desktop";

export interface Project {
  id: string;
  title: string;
  notes: string;
  program: Program | null;
  updatedAt: number;
  /** Masaüstünde kaydedildiği .mimarnot dosyası */
  filePath?: string;
}

export interface ProjectFile {
  format: "mimarnot";
  version: 1;
  title: string;
  notes: string;
  program: Program | null;
  savedAt: string;
}

export function toProjectFile(p: Project): string {
  const f: ProjectFile = { format: "mimarnot", version: 1, title: p.title, notes: p.notes, program: p.program, savedAt: new Date().toISOString() };
  return JSON.stringify(f, null, 2);
}

export function fromProjectFile(text: string): Project {
  const data = JSON.parse(text);
  // Düz bina programı JSON'u da kabul et
  if (data && data.floors && data.footprint) {
    return { ...newProject(data.clientName || data.projectName || "İçe aktarılan"), program: data as Program };
  }
  if (!data || data.format !== "mimarnot") throw new Error("Bu dosya bir Mimar Not projesi değil.");
  return { ...newProject(data.title || "Proje"), notes: data.notes ?? "", program: data.program ?? null };
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
    /* depolama yoksa sessizce geç */
  }
}

export function newProject(title = "Yeni görüşme"): Project {
  return { id: Math.random().toString(36).slice(2, 10), title, notes: "", program: null, updatedAt: Date.now() };
}

export async function generateProgram(notes: string, previous: Program | null): Promise<Program> {
  let res: Response;
  try {
    res = await fetch("api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes, previous: previous ?? undefined }),
    });
  } catch {
    throw new Error("Sunucuya ulaşılamadı. 'npm run dev' ile API sunucusunun çalıştığından emin olun.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Sunucu hatası (${res.status})`);
  return data.program as Program;
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
  svg: "image/svg+xml", png: "image/png", dxf: "application/dxf", glb: "model/gltf-binary", json: "application/json", pdf: "application/pdf",
};

/** Çıktıyı kaydet: masaüstünde "Farklı kaydet" penceresi, tarayıcıda indirme. */
export async function saveOutput(baseName: string, ext: string, data: string | ArrayBuffer | Uint8Array | Blob) {
  if (desktop) {
    const payload = data instanceof Blob ? await data.arrayBuffer() : data;
    return desktop.saveFile(currentProject, baseName, ext, payload);
  }
  download(`${slug(baseName)}.${ext}`, data, MIME[ext] ?? "application/octet-stream");
  return { saved: true };
}
