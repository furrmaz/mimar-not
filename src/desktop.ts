// Masaüstü (Electron) köprüsü; tarayıcıda çalışırken tanımsızdır.
type Data = string | ArrayBuffer | Uint8Array;
export interface UpdateState {
  state: "unsupported" | "checking" | "available" | "none" | "downloading" | "ready" | "error";
  version?: string;
  percent?: number;
  message?: string;
}
export interface DesktopBridge {
  getSettings(): Promise<{ hasKey: boolean; keyHint: string; hasHiggsfield?: boolean; hfHint?: string; outputRoot: string }>;
  setApiKey(key: string): Promise<{ hasKey: boolean }>;
  setHiggsfield?(keyId: string, secret: string): Promise<{ hasHiggsfield: boolean }>;
  saveFile(project: string, name: string, ext: string, data: Data): Promise<{ saved: boolean; path?: string }>;
  saveAndOpen(project: string, name: string, ext: string, data: Data): Promise<{ ok: boolean; path: string; error?: string }>;
  openFolder(project: string): Promise<string>;
  saveProject(name: string, content: string, path?: string): Promise<{ saved: boolean; path?: string }>;
  openProject(): Promise<{ path: string; content: string } | null>;
  onMenu(cb: (cmd: string) => void): () => void;
  checkUpdate(): Promise<{ version: string }>;
  installUpdate(): Promise<void>;
  version(): Promise<string>;
  onUpdate(cb: (st: UpdateState) => void): () => void;
  savePDF(project: string, name: string): Promise<{ saved: boolean; path?: string }>;
}
export const desktop: DesktopBridge | undefined = (window as unknown as { desktop?: DesktopBridge }).desktop;
