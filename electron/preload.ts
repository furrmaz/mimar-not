import { contextBridge, ipcRenderer } from "electron";

type Data = string | ArrayBuffer | Uint8Array;

contextBridge.exposeInMainWorld("desktop", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setApiKey: (key: string) => ipcRenderer.invoke("settings:setKey", key),
  saveFile: (project: string, name: string, ext: string, data: Data) => ipcRenderer.invoke("file:save", { project, name, ext, data }),
  saveAndOpen: (project: string, name: string, ext: string, data: Data) => ipcRenderer.invoke("file:saveAndOpen", { project, name, ext, data }),
  openFolder: (project: string) => ipcRenderer.invoke("folder:open", project),
  saveProject: (name: string, content: string, path?: string) => ipcRenderer.invoke("project:save", { name, content, path }),
  openProject: () => ipcRenderer.invoke("project:open"),
  onMenu: (cb: (cmd: string) => void) => {
    const h = (_e: unknown, cmd: string) => cb(cmd);
    ipcRenderer.on("menu", h);
    return () => ipcRenderer.removeListener("menu", h);
  },
  savePDF: (project: string, name: string) => ipcRenderer.invoke("pdf:save", { project, name }),
});
