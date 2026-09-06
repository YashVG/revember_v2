import { existsSync } from "node:fs";
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
import { ipcChannels } from "../shared/ipc";
import type {
  AppSnapshot,
  AuthActionResult,
  AuthState,
  ArchiveExamPlanInput,
  CaptureCheckpointInput,
  CommitReviewInput,
  CreateCardInput,
  CreateTopicInput,
  CloudSyncResult,
  CloudSyncState,
  EditCardInput,
  McpClient,
  McpConnectionResult,
  RetireCardInput,
  SaveCaptureInput,
  UpsertExamPlanInput
} from "../shared/types";
import { RevemberState } from "./app-state";
import { SupabaseAuth } from "./supabase-auth";
import { AccountVaults } from "./account-vaults";
import { configureMcpClient } from "./mcp-client-config";
import {
  isSafeExternalURL,
  isTrustedRendererURL,
  type RendererDocumentPolicy
} from "./security-policy";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let state: RevemberState;
let cloudAuth: SupabaseAuth;
let accountVaults: AccountVaults;
let notificationTimer: NodeJS.Timeout | undefined;
let pendingRoute: string | undefined;
let pendingAuthCallbackURL: string | undefined;
let rendererDocumentPolicy: RendererDocumentPolicy | undefined;
const DEFAULT_ZOOM_FACTOR = 1.15;
// This is a Supabase publishable key, not a secret. RLS still protects every
// vault row; never substitute a service-role or secret key here.
const DEFAULT_SUPABASE_URL = "https://puspkabdjwwhyvteqker.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Lr8dyUXT4DpwZoahX_BSVg_FzsaGvMl";

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
  const legacyPaths = {
    settingsPath: path.join(app.getPath("userData"), "settings.json"),
    bundledKnowledgeRoot,
    legacyProgressPath: process.platform === "darwin"
      ? path.join(app.getPath("appData"), "RevemberV2", "progress.json")
      : path.join(app.getPath("userData"), "progress.json")
  };
  accountVaults = new AccountVaults(app.getPath("userData"), legacyPaths);
  cloudAuth = new SupabaseAuth({
    sessionPath: path.join(app.getPath("userData"), "supabase-session.json"),
    url: process.env.REVEMBER_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    publishableKey: process.env.REVEMBER_SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_SUPABASE_PUBLISHABLE_KEY
  });
  cloudAuth.on("state", (authState: AuthState) => {
    if (authState.user) {
      const nextState = accountVaults.activate(authState.user.id);
      if (state !== nextState) {
        state = nextState;
        state.on("snapshot", (snapshot: AppSnapshot) => {
          if (state !== nextState || !cloudAuth.state.user) return;
          mainWindow?.webContents.send(ipcChannels.snapshot, snapshot);
          updateTray(snapshot);
          scheduleNotification(snapshot);
        });
      }
      updateTray(state.snapshot);
      scheduleNotification(state.snapshot);
    } else {
      accountVaults.deactivate();
      if (notificationTimer) clearTimeout(notificationTimer);
      tray?.setTitle("");
      tray?.setContextMenu(Menu.buildFromTemplate([{ label: "Open Revember", click: showMainWindow }, { label: "Quit Revember", click: () => app.quit() }]));
    }
    mainWindow?.webContents.send(ipcChannels.authState, authState);
  });
  void cloudAuth.restore().catch(() => {
    // Keep the sign-in UI available when a saved session cannot be restored.
  });
  if (pendingAuthCallbackURL) {
    completeAuthCallback(pendingAuthCallbackURL);
    pendingAuthCallbackURL = undefined;
  }
  registerIPC();
  createMenu();
  createWindow();
  createTray();
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
  cloudAuth?.dispose();
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
  handleState(ipcChannels.getAuthState, (): AuthState => cloudAuth.state);
  handleState(ipcChannels.signUp, (email: string, password: string): Promise<AuthActionResult> => cloudAuth.signUp(email, password));
  handleState(ipcChannels.signIn, (email: string, password: string): Promise<AuthActionResult> => cloudAuth.signIn(email, password));
  handleState(ipcChannels.signOut, (): Promise<AuthState> => cloudAuth.signOut());
  handleState(ipcChannels.getCloudSyncState, (): Promise<CloudSyncState> => cloudAuth.getCloudSyncState());
  handleState(ipcChannels.uploadCloudVault, (): Promise<CloudSyncResult> => cloudAuth.uploadVault(state.exportCloudVault()));
  handleState(ipcChannels.downloadCloudVault, async () => {
    const target = state;
    const userID = cloudAuth.state.user?.id;
    const fingerprint = () => JSON.stringify({ ...target.exportCloudVault(), exportedAt: undefined, settings: target.snapshot.settings });
    const before = fingerprint();
    const remote = await cloudAuth.downloadVault();
    if (accountVaults.requireActive(cloudAuth.state.user?.id) !== target || cloudAuth.state.user?.id !== userID || fingerprint() !== before) {
      throw new Error("Your local vault or account changed during download. Retry after saving your work.");
    }
    const snapshot = target.importCloudVault(remote.archive);
    cloudAuth.confirmDownloadedRevision(remote.sync.revision!);
    return { sync: remote.sync, snapshot };
  });
  handleState(ipcChannels.getSnapshot, () => state.snapshot);
  handleState(ipcChannels.reload, () => state.reload());
  handleState(ipcChannels.createTopic, (input: CreateTopicInput) => state.createTopic(input));
  handleState(ipcChannels.chooseKnowledgeRoot, async () => {
    const target = state;
    const options: Electron.OpenDialogOptions = {
      title: "Choose Revember Knowledge Folder",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (accountVaults.requireActive(cloudAuth.state.user?.id) !== target) throw new Error("Account changed while choosing a folder.");
    return result.canceled || !result.filePaths[0] ? target.snapshot : target.setKnowledgeRoot(result.filePaths[0]);
  });
  handleState(ipcChannels.resetKnowledgeRoot, () => state.resetKnowledgeRoot());
  handleState(ipcChannels.openKnowledgeRoot, async () => {
    const error = await shell.openPath(state.snapshot.settings.knowledgeRootPath);
    if (error) throw new Error(error);
  });
  handleState(ipcChannels.configureMcpClient, (client: McpClient, action: "connect" | "disconnect"): McpConnectionResult => {
    const mcpDirectory = app.isPackaged
      ? path.join(process.resourcesPath, "mcp-server")
      : path.join(app.getAppPath(), "mcp-server");
    const runnerPath = path.join(mcpDirectory, "run-mcp.sh");
    const runtimeFiles = [
      runnerPath,
      path.join(mcpDirectory, "dist", "index.js"),
      path.join(mcpDirectory, "node_modules", "@modelcontextprotocol", "sdk", "package.json")
    ];
    if (action === "connect" && runtimeFiles.some((filePath) => !existsSync(filePath))) {
      throw new Error("Revember's MCP runtime is unavailable. Reinstall the app and try again.");
    }
    return configureMcpClient(client, action, { runnerPath, ...state.snapshot.settings });
  });
  handleState(ipcChannels.commitReview, (input: CommitReviewInput) => state.commitReview(input));
  handleState(ipcChannels.captureCheckpoint, (input: CaptureCheckpointInput) => state.captureCheckpoint(input));
  handleState(ipcChannels.createCard, (input: CreateCardInput) => state.createCard(input));
  handleState(ipcChannels.editCard, (input: EditCardInput) => state.editCard(input));
  handleState(ipcChannels.retireCard, (input: RetireCardInput) => state.retireCard(input));
  handleState(ipcChannels.generateDistractors, (input: unknown) => state.generateDistractors(input));
  handleState(ipcChannels.upsertExamPlan, (input: UpsertExamPlanInput) => state.upsertExamPlan(input));
  handleState(ipcChannels.archiveExamPlan, (input: ArchiveExamPlanInput) => state.archiveExamPlan(input));
  handleState(ipcChannels.listCaptureSummaries, () => state.listCaptureSummaries());
  handleState(ipcChannels.getCapture, (id: string) => state.getCapture(id));
  handleState(ipcChannels.saveCapture, (input: SaveCaptureInput) => state.saveCapture(input));
  handleState(ipcChannels.finishCapture, (id: string, expectedRevision: number) => state.finishCapture(id, expectedRevision));
  handleState(ipcChannels.archiveCapture, (id: string, expectedRevision: number) => state.archiveCapture(id, expectedRevision));
  handleState(ipcChannels.getCaptureSegmentation, (captureID: string, captureRevision: number) => state.getCaptureSegmentation(captureID, captureRevision));
  handleState(ipcChannels.retryCaptureSegmentation, (captureID: string, captureRevision: number) => state.retryCaptureSegmentation(captureID, captureRevision));
  handleState(ipcChannels.setNotifications, (enabled: boolean) => state.setNotificationsEnabled(enabled));
}

function handleState<TArguments extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArguments) => TResult | Promise<TResult>
): void {
  const publicChannels: string[] = [ipcChannels.getAuthState, ipcChannels.signUp, ipcChannels.signIn, ipcChannels.signOut];
  handleTrusted(channel, async (_event, ...args: TArguments) => {
    const active = publicChannels.includes(channel) ? undefined : accountVaults.requireActive(cloudAuth.state.user?.id);
    const result = await handler(...args);
    if (active && accountVaults.requireActive(cloudAuth.state.user?.id) !== active) throw new Error("Account changed during this operation.");
    return result;
  });
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
        { label: "Reload Knowledge", accelerator: "CmdOrCtrl+R", click: () => { if (cloudAuth.state.user) state.reload(); } },
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
    if (!cloudAuth.state.user) return;
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
    if (parsed.hostname === "auth" && parsed.pathname === "/callback") {
      if (!cloudAuth) pendingAuthCallbackURL = url;
      else completeAuthCallback(url);
    } else if (parsed.hostname === "topic") sendRoute(`topic:${parsed.pathname.replace(/^\//, "")}`);
    else if (parsed.hostname === "review") sendRoute(`review:${Math.max(1, Number(parsed.searchParams.get("minutes")) || 3)}`);
  } catch {
    // Invalid deep links are ignored.
  }
}

function completeAuthCallback(url: string): void {
  void cloudAuth.completeEmailCallback(url).then(() => sendRoute("auth:confirmed")).catch(() => undefined);
}

function sendRoute(route: string): void {
  pendingRoute = route;
  if (!app.isReady()) return;
  showMainWindow();
  if (mainWindow && !mainWindow.webContents.isLoading()) mainWindow.webContents.send(ipcChannels.navigate, route);
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
