// Mimar Not masaüstü uygulaması (Electron).
// API sunucusu uygulamanın içinde, yalnızca 127.0.0.1 üzerinde çalışır; arayüz ona bağlanır.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, Menu } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { autoUpdater } from "electron-updater";
import { createApp } from "../server/app";

const isDev = !app.isPackaged;
const FIXED_PORT = 47615;
// Tek örnek: ikinci açılış aynı porta bağlanamayıp ayrı depoyla açılmasın
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let mainWin: BrowserWindow | null = null;
app.on("second-instance", () => { if (mainWin && !mainWin.isDestroyed()) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
const configPath = () => path.join(app.getPath("userData"), "ayarlar.json");

interface Config { apiKeyEnc?: string; apiKeyPlain?: string; model?: string; hfEnc?: string; hfPlain?: string }

function readConfig(): Config {
  try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return {}; }
}
function writeConfig(c: Config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
}
function getApiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const c = readConfig();
  if (c.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(c.apiKeyEnc, "base64")); } catch { /* bozuk */ }
  }
  return c.apiKeyPlain;
}
function setApiKey(key: string) {
  const c = readConfig();
  delete c.apiKeyEnc; delete c.apiKeyPlain;
  if (key) {
    if (safeStorage.isEncryptionAvailable()) c.apiKeyEnc = safeStorage.encryptString(key).toString("base64");
    else c.apiKeyPlain = key;
  }
  writeConfig(c);
}

const enc = (v: string) => (safeStorage.isEncryptionAvailable() ? { e: safeStorage.encryptString(v).toString("base64") } : { p: v });
function getHiggsfield(): { keyId: string; secret: string } | undefined {
  if (process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET) return { keyId: process.env.HF_API_KEY_ID, secret: process.env.HF_API_KEY_SECRET };
  const c = readConfig();
  let raw = c.hfPlain;
  if (c.hfEnc && safeStorage.isEncryptionAvailable()) { try { raw = safeStorage.decryptString(Buffer.from(c.hfEnc, "base64")); } catch { /* bozuk */ } }
  if (!raw) return undefined;
  const [keyId, secret] = raw.split("\n");
  return keyId && secret ? { keyId, secret } : undefined;
}
function setHiggsfield(keyId: string, secret: string) {
  const c = readConfig();
  delete c.hfEnc; delete c.hfPlain;
  if (keyId && secret) { const r = enc(`${keyId}\n${secret}`); if (r.e) c.hfEnc = r.e; else c.hfPlain = r.p; }
  writeConfig(c);
}

/** Çıktıların varsayılan klasörü: Belgeler/Mimar Not/<proje> */
function outputDir(project: string) {
  const safe = project.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Proje";
  const dir = path.join(app.getPath("documents"), "Mimar Not", safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const FILTERS: Record<string, Electron.FileFilter[]> = {
  dxf: [{ name: "AutoCAD DXF", extensions: ["dxf"] }],
  svg: [{ name: "SVG çizim", extensions: ["svg"] }],
  png: [{ name: "PNG görsel", extensions: ["png"] }],
  glb: [{ name: "3D model (glTF)", extensions: ["glb"] }],
  json: [{ name: "Bina programı", extensions: ["json"] }],
  pdf: [{ name: "PDF", extensions: ["pdf"] }],
  ifc: [{ name: "IFC (BIM) modeli", extensions: ["ifc"] }],
};
const toBuffer = (data: string | ArrayBuffer | Uint8Array) =>
  typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);

async function start() {
  const server = createApp({
    getApiKey,
    getHiggsfield,
    model: readConfig().model,
    staticDir: path.join(__dirname, "..", "dist"),
    desktop: true,
  });
  // Sabit port: arayüzün yerel deposu (projeler, antet, hesap oturumu) adrese bağlıdır; port her açılışta
  // değişirse kayıtlar kaybolur. Port doluysa rastgele porta düşülür.
  const listenOn = (p: number) => new Promise<import("node:http").Server>((ok, no) => {
    const l = server.listen(p, "127.0.0.1");
    l.once("listening", () => ok(l));
    l.once("error", no);
  });
  const listener = await listenOn(FIXED_PORT).catch(() => listenOn(0));
  const port = (listener.address() as AddressInfo).port;

  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    title: "Mimar Not",
    backgroundColor: "#f5f4f1",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWin = win;
  // Dış bağlantılar sistem tarayıcısında açılsın
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  // Mikrofon izni (Windows sesli yazma Win+H dışında, tarayıcı dikte denemeleri için)
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "media"));
  setTimeout(() => checkUpdates(win), 5000);
  await win.loadURL(isDev && process.env.VITE_DEV_URL ? process.env.VITE_DEV_URL : `http://127.0.0.1:${port}/`);

  ipcMain.handle("update:check", () => { checkUpdates(win, true); return { version: app.getVersion() }; });
  ipcMain.handle("update:install", () => { if (lastUpdate.state === "ready") autoUpdater.quitAndInstall(); });
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("settings:setHiggsfield", (_e, a: { keyId: string; secret: string }) => { setHiggsfield(String(a?.keyId ?? "").trim(), String(a?.secret ?? "").trim()); return { hasHiggsfield: Boolean(getHiggsfield()) }; });
  ipcMain.handle("settings:get", () => ({ hasKey: Boolean(getApiKey()), keyHint: (getApiKey() ?? "").slice(-4), hasHiggsfield: Boolean(getHiggsfield()), hfHint: (getHiggsfield()?.keyId ?? "").slice(0, 6), outputRoot: path.join(app.getPath("documents"), "Mimar Not") }));
  ipcMain.handle("settings:setKey", (_e, key: string) => { setApiKey(String(key ?? "").trim()); return { hasKey: Boolean(getApiKey()) }; });

  // Kaydet penceresi ile dosya yaz
  ipcMain.handle("file:save", async (_e, a: { project: string; name: string; ext: string; data: string | ArrayBuffer | Uint8Array }) => {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: path.join(outputDir(a.project), `${a.name}.${a.ext}`),
      filters: FILTERS[a.ext] ?? [],
    });
    if (res.canceled || !res.filePath) return { saved: false };
    fs.writeFileSync(res.filePath, toBuffer(a.data));
    return { saved: true, path: res.filePath };
  });

  // Belgeler/Mimar Not/<proje> içine kaydet ve varsayılan programla aç (DXF → AutoCAD)
  ipcMain.handle("file:saveAndOpen", async (_e, a: { project: string; name: string; ext: string; data: string | ArrayBuffer | Uint8Array }) => {
    const file = path.join(outputDir(a.project), `${a.name}.${a.ext}`);
    try {
      fs.writeFileSync(file, toBuffer(a.data));
    } catch (err) {
      return { ok: false, path: file, error: `Dosya yazılamadı (AutoCAD'de açık olabilir): ${(err as Error).message}` };
    }
    const err = await shell.openPath(file);
    return { ok: !err, path: file, error: err || undefined };
  });

  ipcMain.handle("folder:open", (_e, project: string) => shell.openPath(outputDir(project)));

  // Çizim setini PDF olarak kaydet (A3 yatay)
  // Proje dosyası (.mimarnot = JSON)
  ipcMain.handle("project:save", async (_e, a: { name: string; content: string; path?: string }) => {
    let file = a.path;
    if (!file) {
      const res = await dialog.showSaveDialog(win, {
        defaultPath: path.join(outputDir(a.name), `${a.name}.mimarnot`),
        filters: [{ name: "Mimar Not projesi", extensions: ["mimarnot"] }],
      });
      if (res.canceled || !res.filePath) return { saved: false };
      file = res.filePath;
    }
    fs.writeFileSync(file, a.content, "utf8");
    return { saved: true, path: file };
  });
  ipcMain.handle("project:open", async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      defaultPath: path.join(app.getPath("documents"), "Mimar Not"),
      filters: [{ name: "Mimar Not projesi", extensions: ["mimarnot", "json"] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return { path: res.filePaths[0], content: fs.readFileSync(res.filePaths[0], "utf8") };
  });

  ipcMain.handle("pdf:save", async (_e, a: { project: string; name: string }) => {
    const res = await dialog.showSaveDialog(win, { defaultPath: path.join(outputDir(a.project), `${a.name}.pdf`), filters: FILTERS.pdf });
    if (res.canceled || !res.filePath) return { saved: false };
    const pdf = await win.webContents.printToPDF({ landscape: true, pageSize: "A3", printBackground: true, margins: { marginType: "default" } });
    fs.writeFileSync(res.filePath, pdf);
    shell.openPath(res.filePath);
    return { saved: true, path: res.filePath };
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "Dosya", submenu: [
        { label: "Proje aç…", accelerator: "CmdOrCtrl+O", click: () => win.webContents.send("menu", "open") },
        { label: "Projeyi kaydet", accelerator: "CmdOrCtrl+S", click: () => win.webContents.send("menu", "save") },
        { label: "Farklı kaydet…", accelerator: "CmdOrCtrl+Shift+S", click: () => win.webContents.send("menu", "saveAs") },
        { type: "separator" },
        { label: "Güncellemeleri denetle", click: () => { win.webContents.send("menu", "update"); checkUpdates(win, true); } },
        { type: "separator" },
        { label: "Çıktı klasörünü aç", click: () => shell.openPath(path.join(app.getPath("documents"), "Mimar Not")) }, { type: "separator" }, { role: "quit", label: "Çıkış" }] },
      { label: "Düzen", submenu: [{ role: "undo", label: "Geri al" }, { role: "redo", label: "Yinele" }, { type: "separator" }, { role: "cut", label: "Kes" }, { role: "copy", label: "Kopyala" }, { role: "paste", label: "Yapıştır" }, { role: "selectAll", label: "Tümünü seç" }] },
      { label: "Görünüm", submenu: [{ role: "reload", label: "Yenile" }, { role: "zoomIn", label: "Yakınlaştır" }, { role: "zoomOut", label: "Uzaklaştır" }, { role: "resetZoom", label: "Gerçek boyut" }, { role: "togglefullscreen", label: "Tam ekran" }, ...(isDev ? [{ role: "toggleDevTools" as const }] : [])] },
    ]),
  );
}

// Otomatik güncelleme: GitHub Releases (yalnızca kurulum dosyasıyla kurulan sürümde).
// Durum arayüze "update" kanalıyla gönderilir; arayüz düğme/rozet olarak gösterir.
type UpdateState = { state: "unsupported" | "checking" | "available" | "none" | "downloading" | "ready" | "error"; version?: string; percent?: number; message?: string };
let updateWired = false;
let lastUpdate: UpdateState = { state: "none" };
function sendUpdate(win: BrowserWindow, st: UpdateState) {
  lastUpdate = st;
  if (!win.isDestroyed()) win.webContents.send("update", st);
}
function checkUpdates(win: BrowserWindow, manual = false) {
  if (isDev || process.env.PORTABLE_EXECUTABLE_DIR) {
    if (manual) sendUpdate(win, { state: "unsupported", message: "Otomatik güncelleme yalnızca kurulum dosyasıyla (MimarNot-Kurulum) kurulan sürümde çalışır. Yeni sürümü Releases sayfasından indirebilirsiniz." });
    return;
  }
  if (lastUpdate.state === "downloading" || lastUpdate.state === "ready") {
    sendUpdate(win, lastUpdate);
    return;
  }
  if (!updateWired) {
    updateWired = true;
    autoUpdater.autoDownload = true;
    autoUpdater.on("checking-for-update", () => sendUpdate(win, { state: "checking" }));
    autoUpdater.on("update-available", (info) => sendUpdate(win, { state: "available", version: info.version }));
    autoUpdater.on("update-not-available", () => sendUpdate(win, { state: "none", version: app.getVersion() }));
    autoUpdater.on("download-progress", (p) => sendUpdate(win, { state: "downloading", percent: Math.round(p.percent), version: lastUpdate.version }));
    autoUpdater.on("update-downloaded", (info) => sendUpdate(win, { state: "ready", version: info.version }));
    autoUpdater.on("error", (e) => sendUpdate(win, { state: "error", message: String(e?.message ?? e) }));
  }
  autoUpdater.checkForUpdates().catch((e) => sendUpdate(win, { state: "error", message: String(e?.message ?? e) }));
}

app.whenReady().then(() => (gotLock ? start() : undefined)).catch((err) => {
  dialog.showErrorBox("Mimar Not başlatılamadı", String(err?.stack ?? err));
  app.quit();
});
app.on("window-all-closed", () => app.quit());
