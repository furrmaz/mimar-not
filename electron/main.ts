// Mimar Not masaüstü uygulaması (Electron).
// API sunucusu uygulamanın içinde, yalnızca 127.0.0.1 üzerinde çalışır; arayüz ona bağlanır.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, Menu } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { autoUpdater } from "electron-updater";
import { createApp } from "../server/app";

const isDev = !app.isPackaged;
const configPath = () => path.join(app.getPath("userData"), "ayarlar.json");

interface Config { apiKeyEnc?: string; apiKeyPlain?: string; model?: string }

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
};
const toBuffer = (data: string | ArrayBuffer | Uint8Array) =>
  typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);

async function start() {
  const server = createApp({
    getApiKey,
    model: readConfig().model,
    staticDir: path.join(__dirname, "..", "dist"),
    desktop: true,
  });
  const listener = server.listen(0, "127.0.0.1");
  await new Promise((r) => listener.once("listening", r));
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
  // Dış bağlantılar sistem tarayıcısında açılsın
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  // Mikrofon izni (Windows sesli yazma Win+H dışında, tarayıcı dikte denemeleri için)
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "media"));
  setTimeout(() => checkUpdates(win), 5000);
  await win.loadURL(isDev && process.env.VITE_DEV_URL ? process.env.VITE_DEV_URL : `http://127.0.0.1:${port}/`);

  ipcMain.handle("settings:get", () => ({ hasKey: Boolean(getApiKey()), keyHint: (getApiKey() ?? "").slice(-4), outputRoot: path.join(app.getPath("documents"), "Mimar Not") }));
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
        { label: "Güncellemeleri denetle", click: () => checkUpdates(win, true) },
        { type: "separator" },
        { label: "Çıktı klasörünü aç", click: () => shell.openPath(path.join(app.getPath("documents"), "Mimar Not")) }, { type: "separator" }, { role: "quit", label: "Çıkış" }] },
      { label: "Düzen", submenu: [{ role: "undo", label: "Geri al" }, { role: "redo", label: "Yinele" }, { type: "separator" }, { role: "cut", label: "Kes" }, { role: "copy", label: "Kopyala" }, { role: "paste", label: "Yapıştır" }, { role: "selectAll", label: "Tümünü seç" }] },
      { label: "Görünüm", submenu: [{ role: "reload", label: "Yenile" }, { role: "zoomIn", label: "Yakınlaştır" }, { role: "zoomOut", label: "Uzaklaştır" }, { role: "resetZoom", label: "Gerçek boyut" }, { role: "togglefullscreen", label: "Tam ekran" }, ...(isDev ? [{ role: "toggleDevTools" as const }] : [])] },
    ]),
  );
}

// Otomatik güncelleme: GitHub Releases (yalnızca kurulum dosyasıyla kurulan sürümde)
let updateWired = false;
function checkUpdates(win: BrowserWindow, manual = false) {
  if (isDev || process.env.PORTABLE_EXECUTABLE_DIR) {
    if (manual) dialog.showMessageBox(win, { message: "Otomatik güncelleme yalnızca kurulum dosyasıyla kurulan sürümde çalışır. Yeni sürümü Releases sayfasından indirebilirsiniz." });
    return;
  }
  if (!updateWired) {
    updateWired = true;
    autoUpdater.autoDownload = true;
    autoUpdater.on("update-downloaded", async (info) => {
      const r = await dialog.showMessageBox(win, {
        type: "info",
        buttons: ["Şimdi yeniden başlat", "Sonra"],
        defaultId: 0,
        message: `Mimar Not ${info.version} indirildi.`,
        detail: "Güncellemeyi uygulamak için uygulama yeniden başlatılacak. 'Sonra' derseniz kapatırken kurulur.",
      });
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.on("update-not-available", () => { if (manual) dialog.showMessageBox(win, { message: `En güncel sürümü kullanıyorsunuz (${app.getVersion()}).` }); });
    autoUpdater.on("error", (e) => { if (manual) dialog.showMessageBox(win, { type: "warning", message: "Güncelleme denetlenemedi.", detail: String(e?.message ?? e) }); });
  }
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(start).catch((err) => {
  dialog.showErrorBox("Mimar Not başlatılamadı", String(err?.stack ?? err));
  app.quit();
});
app.on("window-all-closed", () => app.quit());
