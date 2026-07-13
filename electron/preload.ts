import { contextBridge, ipcRenderer } from "electron";
import type { AppSnapshot, CaptureCheckpointInput, CaptureCheckpointResult, CommitReviewInput, CommitReviewResult, RevemberAPI } from "../shared/types";

const api: RevemberAPI = {
  getSnapshot: () => ipcRenderer.invoke("revember:get-snapshot") as Promise<AppSnapshot>,
  reload: () => ipcRenderer.invoke("revember:reload") as Promise<AppSnapshot>,
  chooseKnowledgeRoot: () => ipcRenderer.invoke("revember:choose-knowledge-root") as Promise<AppSnapshot>,
  resetKnowledgeRoot: () => ipcRenderer.invoke("revember:reset-knowledge-root") as Promise<AppSnapshot>,
  openKnowledgeRoot: () => ipcRenderer.invoke("revember:open-knowledge-root") as Promise<void>,
  commitReview: (input: CommitReviewInput) => ipcRenderer.invoke("revember:commit-review", input) as Promise<CommitReviewResult>,
  captureCheckpoint: (input: CaptureCheckpointInput) => ipcRenderer.invoke("revember:capture-checkpoint", input) as Promise<CaptureCheckpointResult>,
  setNotificationsEnabled: (enabled: boolean) => ipcRenderer.invoke("revember:set-notifications", enabled) as Promise<AppSnapshot>,
  onSnapshot: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on("revember:snapshot", listener);
    return () => ipcRenderer.removeListener("revember:snapshot", listener);
  },
  onNavigate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, route: string) => callback(route);
    ipcRenderer.on("revember:navigate", listener);
    return () => ipcRenderer.removeListener("revember:navigate", listener);
  }
};

contextBridge.exposeInMainWorld("revember", api);
