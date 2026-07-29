import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  type IpcMainInvokeEvent
} from "electron";
import { dueReviewItems, nextDueAt } from "../shared/domain";
import type {
  AppSnapshot,
  ArchiveExamPlanInput,
  CaptureCheckpointInput,
  CommitReviewInput,
  CreateCardInput,
  CreateTopicInput,
  EditCardInput,
  RetireCardInput,
  SaveCaptureInput,
  UpsertExamPlanInput
} from "../shared/types";
import { RevemberState } from "./app-state";
import {
  isSafeExternalURL,
  isTrustedRendererURL,
  type RendererDocumentPolicy
} from "./security-policy";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let state: RevemberState;
let notificationTimer: NodeJS.Timeout | undefined;
let pendingRoute: string | undefined;
let rendererDocumentPolicy: RendererDocumentPolicy | undefined;
const DEFAULT_ZOOM_FACTOR = 1.15;

if (process.env.REVEMBER_USER_DATA_PATH) {
  app.setPath("userData", path.resolve(process.env.REVEMBER_USER_DATA_PATH));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on("second-instance", (_event, argv) => {
  showMainWindow();
  const url = argv.find((argument) => argument.startsWith("revember://"));
  if (url) routeURL(url);
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  routeURL(url);
});

app.whenReady().then(() => {
  app.setName("Revember");
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient("revember");
  } else if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient("revember", process.execPath, [path.resolve(process.argv[1])]);
  }
  const bundledKnowledgeRoot = app.isPackaged
    ? path.join(process.resourcesPath, "RevemberKnowledge")
    : path.join(app.getAppPath(), "RevemberKnowledge");
  state = new RevemberState({
    settingsPath: path.join(app.getPath("userData"), "settings.json"),
    bundledKnowledgeRoot,
    legacyProgressPath: process.platform === "darwin"
      ? path.join(app.getPath("appData"), "RevemberV2", "progress.json")
      : path.join(app.getPath("userData"), "progress.json")
  });
  state.on("snapshot", (snapshot: AppSnapshot) => {
    mainWindow?.webContents.send("revember:snapshot", snapshot);
    updateTray(snapshot);
    scheduleNotification(snapshot);
  });

  registerIPC();
  createMenu();
  createWindow();
  createTray();
  updateTray(state.snapshot);
  scheduleNotification(state.snapshot);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else showMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  state?.dispose();
  if (notificationTimer) clearTimeout(notificationTimer);
});

function createWindow(): void {
  const developmentURL = process.env.ELECTRON_RENDERER_URL;
  const packagedDocumentPath = path.join(__dirname, "../renderer/index.html");
  const rendererURL = developmentURL
    ? new URL(developmentURL).href
    : pathToFileURL(packagedDocumentPath).href;
  rendererDocumentPolicy = {
    documentURL: rendererURL,
    allowDevelopmentOrigin: Boolean(developmentURL)
  };
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1020,
    minHeight: 680,
    show: false,
    title: "Revember",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#08090b",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (pendingRoute) sendRoute(pendingRoute);
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (rendererDocumentPolicy && isTrustedRendererURL(url, rendererDocumentPolicy)) return;
    event.preventDefault();
    openExternal(url);
  });

  if (developmentURL) {
    void mainWindow.loadURL(rendererURL);
  } else {
    void mainWindow.loadFile(packagedDocumentPath);
  }
}

function registerIPC(): void {
  handleTrusted("revember:get-snapshot", () => state.snapshot);
  handleTrusted("revember:reload", () => state.reload());
  handleTrusted("revember:create-topic", (_event, input: CreateTopicInput) => state.createTopic(input));
  handleTrusted("revember:choose-knowledge-root", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Choose Revember Knowledge Folder",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? state.snapshot : state.setKnowledgeRoot(result.filePaths[0]);
  });
  handleTrusted("revember:reset-knowledge-root", () => state.resetKnowledgeRoot());
  handleTrusted("revember:open-knowledge-root", async () => {
    const error = await shell.openPath(state.snapshot.settings.knowledgeRootPath);
    if (error) throw new Error(error);
  });
  handleTrusted("revember:commit-review", (_event, input: CommitReviewInput) => state.commitReview(input));
  handleTrusted("revember:capture-checkpoint", (_event, input: CaptureCheckpointInput) => state.captureCheckpoint(input));
  handleTrusted("revember:create-card", (_event, input: CreateCardInput) => state.createCard(input));
  handleTrusted("revember:edit-card", (_event, input: EditCardInput) => state.editCard(input));
  handleTrusted("revember:retire-card", (_event, input: RetireCardInput) => state.retireCard(input));
  handleTrusted("revember:generate-distractors", (_event, input: unknown) => state.generateDistractors(input));
  handleTrusted("revember:upsert-exam-plan", (_event, input: UpsertExamPlanInput) => state.upsertExamPlan(input));
  handleTrusted("revember:archive-exam-plan", (_event, input: ArchiveExamPlanInput) => state.archiveExamPlan(input));
  handleTrusted("revember:list-capture-summaries", () => state.listCaptureSummaries());
  handleTrusted("revember:get-capture", (_event, id: string) => state.getCapture(id));
  handleTrusted("revember:save-capture", (_event, input: SaveCaptureInput) => state.saveCapture(input));
  handleTrusted("revember:generate-topic-note", (_event, topicID: string) => state.generateTopicNote(topicID));
  handleTrusted("revember:finish-capture", (_event, id: string, expectedRevision: number) => state.finishCapture(id, expectedRevision));
  handleTrusted("revember:archive-capture", (_event, id: string, expectedRevision: number) => state.archiveCapture(id, expectedRevision));
  handleTrusted("revember:get-capture-enrichment", (_event, captureID: string, captureRevision: number) => state.getCaptureEnrichment(captureID, captureRevision));
  handleTrusted("revember:retry-capture-enrichment", (_event, captureID: string, captureRevision: number) => state.retryCaptureEnrichment(captureID, captureRevision));
  handleTrusted("revember:get-capture-segmentation", (_event, captureID: string, captureRevision: number) => state.getCaptureSegmentation(captureID, captureRevision));
  handleTrusted("revember:retry-capture-segmentation", (_event, captureID: string, captureRevision: number) => state.retryCaptureSegmentation(captureID, captureRevision));
  handleTrusted("revember:set-notifications", (_event, enabled: boolean) => state.setNotificationsEnabled(enabled));
}

function handleTrusted<TArguments extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArguments) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedRenderer(event);
    return handler(event, ...(args as TArguments));
  });
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const trustedContents = mainWindow?.webContents;
  if (
    !trustedContents
    || trustedContents.isDestroyed()
    || event.sender !== trustedContents
  ) {
    throw new Error("Revember rejected an IPC request from an untrusted renderer.");
  }
  const senderFrame = event.senderFrame;
  const trustedFrame = trustedContents.mainFrame;
  if (
    !senderFrame
    || senderFrame.detached
    || senderFrame.isDestroyed()
    || senderFrame.frameTreeNodeId !== trustedFrame.frameTreeNodeId
    || !rendererDocumentPolicy
    || !isTrustedRendererURL(senderFrame.url, rendererDocumentPolicy)
  ) {
    throw new Error("Revember rejected an IPC request from an untrusted renderer.");
  }
}

function createMenu(): void {
  const menu = Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{
      label: app.name,
      submenu: [
        { role: "about" as const },
        { type: "separator" as const },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => sendRoute("settings") },
        { type: "separator" as const },
        { role: "services" as const },
        { type: "separator" as const },
        { role: "hide" as const },
        { role: "hideOthers" as const },
        { role: "unhide" as const },
        { type: "separator" as const },
        { role: "quit" as const }
      ]
    }] : []),
    {
      label: "File", submenu: [
        routeCommand("Start 3-Minute Review", "review:3", "CmdOrCtrl+Shift+R"),
        routeCommand("Capture Learning Checkpoint…", "checkpoint", "CmdOrCtrl+Shift+K"),
        { label: "Reload Knowledge", accelerator: "CmdOrCtrl+R", click: () => state.reload() },
        { type: "separator" },
        { role: "close" }
      ]
    },
    {
      label: "Edit", submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }
      ]
    },
    {
      label: "View", submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" },
        { label: "Reset Zoom (115%)", accelerator: "CmdOrCtrl+0", click: () => mainWindow?.webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR) },
        { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }
      ]
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, ...(process.platform === "darwin" ? [{ type: "separator" as const }, { role: "front" as const }] : [])] }
  ]);
  Menu.setApplicationMenu(menu);
}

function createTray(): void {
  const image = process.platform === "darwin"
    ? nativeImage.createFromNamedImage("NSStatusAvailable")
    : nativeImage.createEmpty();
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Revember");
  tray.on("click", showMainWindow);
}

function updateTray(snapshot: AppSnapshot): void {
  if (!tray) return;
  const dueCount = dueReviewItems(snapshot).length;
  tray.setTitle(process.platform === "darwin" && dueCount > 0 ? `${dueCount}` : "");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: dueCount ? `${dueCount} checks ready` : "Nothing due now", enabled: false },
    { type: "separator" },
    { label: "Open Revember", click: showMainWindow },
    routeCommand("Start 3-Minute Review", "review:3"),
    routeCommand("Capture Learning Checkpoint…", "checkpoint"),
    { type: "separator" },
    { label: "Quit Revember", click: () => app.quit() }
  ]));
}

function scheduleNotification(snapshot: AppSnapshot): void {
  if (notificationTimer) clearTimeout(notificationTimer);
  if (!snapshot.settings.notificationsEnabled || !Notification.isSupported()) return;
  const due = dueReviewItems(snapshot);
  const dueAt = nextDueAt(snapshot);
  if (!due.length && !dueAt) return;
  const dueTimestamp = dueAt ? Date.parse(dueAt) : Number.NaN;
  if (!due.length && !Number.isFinite(dueTimestamp)) return;
  const delay = due.length ? 60_000 : Math.max(60_000, dueTimestamp - Date.now());
  notificationTimer = setTimeout(() => {
    const latest = state.snapshot;
    const count = dueReviewItems(latest).length;
    if (!count) {
      scheduleNotification(latest);
      return;
    }
    const notification = new Notification({
      title: "Revember review ready",
      body: count === 1 ? "One check is ready." : `${count} checks are ready.`
    });
    notification.on("click", () => sendRoute("review:3"));
    notification.show();
  }, Math.min(delay, 2_147_000_000));
}

function routeURL(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "revember:") return;
    if (parsed.hostname === "topic") sendRoute(`topic:${parsed.pathname.replace(/^\//, "")}`);
    else if (parsed.hostname === "review") sendRoute(`review:${Math.max(1, Number(parsed.searchParams.get("minutes")) || 3)}`);
  } catch {
    // Invalid deep links are ignored.
  }
}

function sendRoute(route: string): void {
  pendingRoute = route;
  if (!app.isReady()) return;
  showMainWindow();
  if (mainWindow && !mainWindow.webContents.isLoading()) mainWindow.webContents.send("revember:navigate", route);
}

function showMainWindow(): void {
  if (!mainWindow) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

function routeCommand(label: string, route: string, accelerator?: string) {
  return {
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => sendRoute(route)
  };
}

function openExternal(url: string): void {
  if (!isSafeExternalURL(url)) return;
  void shell.openExternal(url).catch(() => {
    // Refusing or failing to open a browser must not destabilize the app.
  });
}
