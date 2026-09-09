const { app, BrowserWindow, Notification, screen, ipcMain, globalShortcut, nativeTheme, dialog, shell, nativeImage, powerSaveBlocker, powerMonitor, clipboard, safeStorage, protocol, net } = require("electron");
const { maybeRunPackageKoffiSmoke } = require("./shell/package-koffi-smoke");
if (maybeRunPackageKoffiSmoke({ app, BrowserWindow })) {
  return;
}

const { clampTextScale, scaleWidth, scaleHeight, resolveTextScaleForKey } = require("./shell/text-scale");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const {
  applyWindowsAppUserModelId,
  shouldOpenSettingsWindowFromArgv,
} = require("./shell/settings-window-icon");
const createSettingsWindowRuntime = require("./shell/settings-window");
const createRoamFenceLoader = require("./robots/duck/roam-fence");
const createRoamFenceSettings = require("./robots/duck/roam-fence-settings");
const createRoamFencePicker = require("./robots/duck/roam-fence-picker");
const createPermissionAutomationConfirmationRuntime = require("./state/permission-automation-confirmation");
const {
  createSettingsSizePreviewSession,
} = require("./shell/settings-size-preview-session");
const { registerSettingsIpc } = require("./shell/settings-ipc");
const createSettingsEffectRouter = require("./shell/settings-effect-router");
const {
  getPetTintIdForTheme,
  resolvePetTintPayload,
  buildPetAccessoryPayload,
  getPetMouthAccessoryIdForTheme,
  buildPetMouthAccessoryPayload,
} = require("./shell/pet-customization-catalog");
const {
  finalizePetAccessorySlotsDelivery,
  getPetAccessorySlotsSnapshot,
  preparePetAccessorySlotsDelivery,
} = require("./shell/pet-accessory-state");
const {
  getEffectivePetAccessoryIdForTheme,
  createHolidayAccessoryRuntime,
} = require("./shell/holiday-accessory");
const { registerSessionIpc } = require("./state/session-ipc");
const { createSessionAutomationStore } = require("./state/session-automation-store");
const { createSessionAutomationCoordinator } = require("./state/session-automation-coordinator");
const {
  selectSessionAutomationDialogParent,
} = require("./state/session-automation-dialog-parent");
const { createSessionFolderOpener } = require("./state/session-open-folder");
const { isTrustedMainFrameEvent, registerPetInteractionIpc } = require("./shell/pet-interaction-ipc");
const { createSystemWakeRecovery } = require("./shell/system-wake-recovery");
const { formatLocalTimestamp } = require("./shell/log-timestamp");
const { launchClaudeSession, openTerminalAt } = require("./state/launch-claude");
const { dialog: electronDialog } = require("electron");
const initPermission = require("./state/permission");
const { isPassiveNotifyEntry } = require("./state/passive-notify-entry");
const { registerPermissionIpc } = initPermission;
const { resolveAgentDisplayName } = require("./state/agent-display-name");
const { createTrayBalloonOwner } = require("./shell/tray-balloon-owner");
const initUpdateBubble = require("./shell/update-bubble");
const { registerUpdateBubbleIpc } = initUpdateBubble;
const createSettingsAnimationOverridesMain = require("./shell/settings-animation-overrides-main");
const { registerSettingsAnimationOverridesIpc } = createSettingsAnimationOverridesMain;
const createShortcutRuntime = require("./shell/shortcut-runtime");
const {
  findNearestWorkArea,
  buildDisplaySnapshot,
  SYNTHETIC_WORK_AREA,
} = require("./shell/work-area");
const {
  isUsableWorkArea: isUsableBubbleWorkArea,
  resolveBubbleWorkArea,
} = require("./shell/bubble-work-area");
const {
  getLaunchPixelSize,
  getLaunchSizingWorkArea,
  getProportionalPixelSize,
} = require("./shell/size-utils");
const { keepOutOfTaskbar } = require("./shell/taskbar");
const { loadTrayNormalIcon, loadTrayFlashIcon } = require("./shell/tray-flash-icon");
const {
  installStartupDockIcon,
  resolveRuntimeDockIconPolicy,
} = require("./shell/mac-dock-icon-runtime");
const createTopmostRuntime = require("./shell/topmost-runtime");
const { WIN_TOPMOST_LEVEL } = createTopmostRuntime;
const {
  createHitWindowActivationRuntime,
} = require("./shell/win-hit-window-activation");
const createThemeFadeSequencer = require("./shell/theme-fade-sequencer");
const createThemeRuntime = require("./shell/theme-runtime");
const createAgentRuntimeMain = require("./state/agent-runtime-main");
const createFloatingWindowRuntime = require("./shell/floating-window-runtime");
const createPetWindowRuntime = require("./shell/pet-window-runtime");
const { collectRequiredAssetFiles } = require("./shell/theme-schema");
const { describeGeometrySync } = require("./shell/pet-accessory-state");
const { createDisplayedVisualProjection } = require("./shell/displayed-visual-projection");
const { createTestReactionHandler } = require("./state/test-reaction");
const createMacHideController = require("./shell/mac-hide");
const {
  getFocusableLocalHudSessionIds: selectFocusableLocalHudSessionIds,
  getSessionFocusTarget,
} = require("./state/session-focus");
const { focusCodexThreadTarget } = require("./state/session-focus-handoff");
const { isSessionInProgress } = require("./state/state-session-snapshot");
const { restoreSessionsFromRecoveryLeases } = require("./state/session-recovery-loader");
const { getAllAgents } = require("../agents/registry");
// ── Autoplay policy: allow sound playback without user gesture ──
// MUST be set before any BrowserWindow is created (before app.whenReady)
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// ── pet-model:// ONNX policy protocol ──
// MUST be registered before app.whenReady(); the handler is installed inside it.
const { pathToFileURL } = require("url");
const petModelProtocol = require("./robots/duck/pet-model-protocol");
petModelProtocol.registerScheme(protocol);

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWin = process.platform === "win32";
const LINUX_WINDOW_TYPE = "toolbar";
const THEME_SWITCH_FADE_OUT_MS = 140;
const THEME_SWITCH_FADE_IN_MS = 180;
const THEME_SWITCH_FADE_FALLBACK_MS = 4000;

applyWindowsAppUserModelId(app, process.platform);


// ── Windows: AllowSetForegroundWindow via FFI ──
let _allowSetForeground = null;
if (isWin) {
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    _allowSetForeground = user32.func("bool __stdcall AllowSetForegroundWindow(int dwProcessId)");
  } catch (err) {
    console.warn("Duck: koffi/AllowSetForegroundWindow not available:", err.message);
  }
}

// ── Windows: foreground-fullscreen probe (suppress topmost over games) ──
// Best-effort; degrades to "never fullscreen" if koffi/user32 is unavailable,
// so a broken probe can never hide the pet.
const { createForegroundFullscreenProbe } = require("./shell/win-fullscreen-detect");
const _isForegroundFullscreen = createForegroundFullscreenProbe({
  isWin,
  onError: (err) => console.warn("Duck: win-fullscreen-detect not available:", err && err.message),
});
const _hitWindowActivationRuntime = createHitWindowActivationRuntime({
  isWin,
  getHitWindow: () => hitWin,
  onError: (err) => console.warn("Duck: win-hit-window-activation failed:", err && err.message),
});

// ── Windows: DWM cloak inspection + un-cloak (#525 self-heal) ──
// Best-effort; degrades to "never cloaked / recovery no-op" when koffi/dwmapi
// or the virtual-desktop COM manager is unavailable.
const { createCloakInspector } = require("./shell/win-cloak-recovery");
const _cloakInspector = createCloakInspector({
  isWin,
  log: (line) => console.warn(`Duck: ${line}`),
});

// ── Windows: foreground Windows Terminal probe (server-side wt_hwnd sample,
// #627 residual) ──
// Best-effort; degrades to "never sampled" (always null) if koffi/user32 is
// unavailable, so a broken probe never blocks a /state POST — wt_hwnd just
// falls back to the session's last-known value (state.js merge). Never spawns
// a subprocess, so it cannot reproduce the console flash it exists to avoid.
const { createForegroundWindowsTerminalProbe } = require("./shell/win-foreground-terminal");
const _captureForegroundWindowsTerminal = createForegroundWindowsTerminalProbe({
  isWin,
  onError: (err) => console.warn("Duck: win-foreground-terminal not available:", err && err.message),
});

// ── Windows: switch the dev console to UTF-8 ──
//
// `npm start` attaches Duck to a parent PowerShell/cmd console. That
// console defaults to the system codepage (CP936 on zh-CN), so any
// Chinese string we console.log lands as mojibake — the strings are
// already UTF-8 in memory (after the GBK stderr decode fix), but the
// console interprets the bytes as GBK on the way out.
//
// SetConsoleOutputCP(65001) tells the attached console to interpret
// stdout/stderr as UTF-8 while Duck is running. Packaged builds run under
// the Windows GUI subsystem with no console attached, so this call is a
// no-op there.
let _restoreConsoleOutputCP = null;
if (isWin) {
  try {
    const koffi = require("koffi");
    const kernel32 = koffi.load("kernel32.dll");
    const getConsoleOutputCP = kernel32.func("uint __stdcall GetConsoleOutputCP()");
    const setConsoleOutputCP = kernel32.func("bool __stdcall SetConsoleOutputCP(uint wCodePageID)");
    const previousOutputCP = getConsoleOutputCP();
    if (setConsoleOutputCP(65001) && previousOutputCP && previousOutputCP !== 65001) {
      let restored = false;
      _restoreConsoleOutputCP = () => {
        if (restored) return;
        restored = true;
        try { setConsoleOutputCP(previousOutputCP); } catch {}
      };
      app.once("will-quit", _restoreConsoleOutputCP);
      process.once("exit", _restoreConsoleOutputCP);
    }
  } catch (err) {
    // Best-effort — mojibake in dev console is annoying but not fatal.
    console.warn("Duck: SetConsoleOutputCP(65001) failed:", err && err.message);
  }
}


// ── Window size presets ──
const SIZES = {
  S: { width: 200, height: 200 },
  M: { width: 280, height: 280 },
  L: { width: 360, height: 360 },
};

// ── Settings (prefs.js + settings-controller.js) ──
//
// `prefs.js` handles disk I/O + schema validation + migrations.
// `settings-controller.js` is the single writer of the in-memory snapshot.
// Module-level `lang`/`showTray`/etc. below are mirror caches kept in sync via
// a subscriber wired after menu.js loads. The ctx setters route writes through
// `_settingsController.applyUpdate()`, which auto-persists.
const prefsModule = require("./shell/prefs");
const { createSettingsController } = require("./shell/settings-controller");
const { createTranslator, i18n, SUPPORTED_LANGS } = require("./shell/i18n");
const {
  getBubblePolicy,
  isAllBubblesHidden,
} = require("./shell/bubble-policy");
const loginItemHelpers = require("./shell/login-item");
const { writeCodexAutoStartGate } = require("../hooks/server-config");
const { createCodexAutoStartGateEvaluator } = require("./state/agent-gate");
const PREFS_PATH = path.join(app.getPath("userData"), "duck-prefs.json");
const _initialPrefsLoad = prefsModule.load(PREFS_PATH);
// Recovery from readable invalid contents is writable only after the original
// bytes are safely kept in .bak. That fallback is not user intent for this
// process, and a backup failure locks persistence as well. Runtime gates stay
// closed until restart in either case.
const _initialPrefsRecovered = _initialPrefsLoad.recovered === true;
const _initialPrefsRecoveryBackupFailed = _initialPrefsLoad.recoveryBackupFailed === true;
const _codexAutoStartAuthorityLost = (
  _initialPrefsLoad.locked === true
  || _initialPrefsRecovered
  || _initialPrefsRecoveryBackupFailed
  || _initialPrefsLoad.codexAutoStartAuthoritative === false
);
const _evaluateCodexAutoStartGate = createCodexAutoStartGateEvaluator({
  authorityLost: _codexAutoStartAuthorityLost,
});

function _persistCodexAutoStartGate(enabled) {
  return writeCodexAutoStartGate(enabled === true);
}

function _syncCodexAutoStartGate(snapshot, source) {
  if (_persistCodexAutoStartGate(_evaluateCodexAutoStartGate(snapshot))) return true;
  console.warn(`Duck: failed to sync Codex auto-start gate (${source})`);
  return false;
}

// Lazy helpers — these run inside the action `effect` callbacks at click time,
// long after server.js / hooks/install.js are loaded. Wrapping them in closures
// avoids a chicken-and-egg require order at module load.
//
// All of these route through _server's Claude hook operation queue rather than
// requiring hooks/install.js directly: every process-internal settings.json
// mutation must be serialized against the fs watcher, periodic health audit,
// and other Settings actions (#657).
function _installAutoStartHook() {
  return _server.setClaudeAutoStart({ enabled: true, source: "auto-start" });
}
function _uninstallAutoStartHook() {
  return _server.setClaudeAutoStart({ enabled: false, source: "auto-start" });
}
async function _uninstallClaudeHooksNow() {
  return _server.uninstallClaudeHooks({ source: "settings", automatic: false });
}

// Cross-platform "open at login" writer used by both the openAtLogin effect
// and the startup hydration helper. Throws on failure so the action layer can
// surface the error to the UI.
function _writeSystemOpenAtLogin(enabled) {
  if (isLinux) {
    const launchScript = path.join(__dirname, "..", "launch.js");
    const execCmd = app.isPackaged
      ? `"${app.getPath("exe")}"`
      : `node "${launchScript}"`;
    loginItemHelpers.linuxSetOpenAtLogin(enabled, { execCmd });
    return;
  }
  app.setLoginItemSettings(
    loginItemHelpers.getLoginItemSettings({
      isPackaged: app.isPackaged,
      openAtLogin: enabled,
      execPath: process.execPath,
      appPath: app.getAppPath(),
    })
  );
}
function _readSystemOpenAtLogin() {
  if (isLinux) return loginItemHelpers.linuxGetOpenAtLogin();
  return app.getLoginItemSettings(
    app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] }
  ).openAtLogin;
}

// Per-agent install-time options. No surviving agent contributes any today, so
// this reports none; the read stays wired through server.js into
// integration-sync so an agent that needs options has somewhere to put them.
function _getAgentIntegrationOptions() {
  return {};
}

function _resolveAgentDisplayName(agentId) {
  return resolveAgentDisplayName(agentId, _settingsController.get("customApplications"));
}

function _deferredResizePet(sizeKey) {
  // Bound to _menu.resizeWindow after menu module is created below. Settings
  // panel's size slider commands route through here so they get the same
  // window resize + hitWin sync + bubble reposition as the context menu.
  if (_menu && typeof _menu.resizeWindow === "function") {
    _menu.resizeWindow(sizeKey);
  }
}

let _restartScheduled = false;
function _restartDuckNow() {
  if (_restartScheduled) return;
  _restartScheduled = true;
  // Triggered by Doctor's restart-duck repair. relaunch() queues a fresh
  // process; quit() then follows the normal shutdown path so before-quit
  // still flushes prefs and cleans up server/monitor resources.
  // setImmediate so the IPC reply for repairDoctorIssue lands in the
  // renderer before the main process starts closing windows.
  setImmediate(() => {
    isQuitting = true;
    app.relaunch();
    app.quit();
  });
}

let shortcutRuntime = null;
let themeRuntime = null;
let agentRuntime = null;
let sessionAutomationCoordinator = null;
let sessionAutomationStore = null;
let systemWakeRecovery = null;
let floatingWindowRuntime = null;
let codexPetMain = null;
const trayBalloonOwner = createTrayBalloonOwner();
let displayedVisualProjection = null;
let lastAppliedVisualGeneration = 0;
const shortcutHandlers = {
  togglePet: () => togglePetVisibility(),
};
const _settingsController = createSettingsController({
  prefsPath: PREFS_PATH,
  loadResult: _initialPrefsLoad,
  injectedDeps: {
    openRobotLab: () => robotLabRuntime.open(),
    agentMcpManager: require("./state/agent-mcp").createAgentMcpManager({
      labDir: app.isPackaged
        ? path.join(process.resourcesPath, "robot-lab-mcp")
        : path.join(__dirname, "../mcp/robot-lab"),
    }),
    installAutoStart: _installAutoStartHook,
    uninstallAutoStart: _uninstallAutoStartHook,
    resolveTextScaleDisplayKey: () => getSettingsDisplayKey(),
    syncClaudeHooksNow: () => _server.syncDuckHooks({ source: "settings", automatic: false }),
    setClaudeQuotaCollectionEnabled: (enabled) => _server.setClaudeQuotaCollectionEnabled({
      enabled,
      source: "settings-quota-collection",
    }),
    uninstallClaudeHooksNow: _uninstallClaudeHooksNow,
    startClaudeSettingsWatcher: () => _server.startClaudeSettingsWatcher(),
    stopClaudeSettingsWatcher: () => _server.stopClaudeSettingsWatcher(),
    setOpenAtLogin: _writeSystemOpenAtLogin,
    startMonitorForAgent: (id) => agentRuntime && agentRuntime.startMonitorForAgent(id),
    stopMonitorForAgent: (id) => agentRuntime && agentRuntime.stopMonitorForAgent(id),
    syncIntegrationForAgent: (id, options) =>
      agentRuntime ? agentRuntime.syncIntegrationForAgent(id, options) : false,
    repairIntegrationForAgent: (id, options) =>
      agentRuntime ? agentRuntime.repairIntegrationForAgent(id, options) : false,
    stopIntegrationForAgent: (id) => agentRuntime ? agentRuntime.stopIntegrationForAgent(id) : false,
    uninstallIntegrationForAgent: (id) => agentRuntime ? agentRuntime.uninstallIntegrationForAgent(id) : false,
    writeCodexAutoStartGate: _persistCodexAutoStartGate,
    deployHooksToWsl: async (distro, agentId) => {
      const { deployToWsl } = require("./state/wsl-deploy");
      return deployToWsl(distro, { agentId, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });
    },
    removeHooksFromWsl: async (distro, agentId) => {
      const { removeFromWsl } = require("./state/wsl-deploy");
      return removeFromWsl(distro, { agentId, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });
    },
    cleanupIntegrations: async (options = {}) => {
      // Claude hooks + statusline unregister as one queue task, awaited here so
      // it settles (and any in-flight repair drains) before the generic cleaner
      // runs. hooks/cleanup-integrations.js records this precomputed result
      // instead of unregistering Claude a second time outside the queue.
      const claudeCleanupResult = await _server.uninstallClaudeHooks({ source: "cleanup", automatic: false });
      const { cleanupIntegrations } = require("../hooks/cleanup-integrations.js");
      return cleanupIntegrations({ ...options, backup: true, silent: true, claudeCleanupResult });
    },
    repairLocalServer: () => _server && typeof _server.repairRuntimeStatus === "function"
      ? _server.repairRuntimeStatus()
      : false,
    restartDuck: _restartDuckNow,
    clearSessionsByAgent: (id) => agentRuntime ? agentRuntime.clearSessionsByAgent(id) : 0,
    clearSessionAutomationByAgent: (id) =>
      sessionAutomationCoordinator ? sessionAutomationCoordinator.clearAgent(id) : [],
    dismissPermissionsByAgent: (id, options) => agentRuntime ? agentRuntime.dismissPermissionsByAgent(id, options) : 0,
    clearRecentHookEvents: (id) => _server.clearRecentHookEvents(id),
    identifyCustomApplication: (sourcePath) => require("./state/custom-applications").identifyCustomApplication(sourcePath),
    resizePet: _deferredResizePet,
    getActiveSessionAliasKeys: () =>
      _state && typeof _state.getActiveSessionAliasKeys === "function"
        ? _state.getActiveSessionAliasKeys()
        : new Set(),
    // Theme runtime is wired after theme-loader.init(); keep these closures
    // lazy so settings actions never capture a pre-init runtime reference.
    activateTheme: (id, variantId, overrideMap) => themeRuntime.activateTheme(id, variantId, overrideMap),
    refreshActiveThemeHitboxOverrides: (id, overrideMap) =>
      themeRuntime.refreshActiveThemeHitboxOverrides(id, overrideMap),
    getThemeInfo: (id) => themeRuntime.getThemeInfo(id),
    removeThemeDir: (id) => themeRuntime.removeThemeDir(id),
    getActiveTheme: () => themeRuntime.getActiveTheme(),
    globalShortcut,
    shortcutHandlers,
    // The controller is created before shortcutRuntime because each side needs
    // the other. These callbacks may run before the runtime is assigned.
    getShortcutFailure: (actionId) => shortcutRuntime ? shortcutRuntime.getFailure(actionId) : null,
    clearShortcutFailure: (actionId) => {
      if (shortcutRuntime) shortcutRuntime.clearFailure(actionId);
    },
  },
});
_settingsController.subscribeKey("agents", (_agents, snapshot) => {
  // A readable future-version prefs file may still change in memory for the
  // current process. An unreadable prefs file rejects mutations earlier in the
  // controller. In both locked cases, publishing ephemeral values would let a
  // retained hook cold-launch Duck against a different durable prefs truth.
  if (_settingsController.isLocked()) return;
  _syncCodexAutoStartGate(snapshot, "settings");
});
_settingsController.subscribeKey("autoStartWithCodex", (_enabled, snapshot) => {
  if (_settingsController.isLocked()) return;
  _syncCodexAutoStartGate(snapshot, "settings");
});
// Mirror of `_settingsController.get("lang")` so existing sync read sites in
// menu.js / state.js / etc. don't have to round-trip through the controller.
// Updated by the settings-effect-router subscriber below; never
// assign directly.
let lang = _settingsController.get("lang");
const translate = createTranslator(() => lang);

function getDashboardI18nPayload() {
  const dict = i18n[lang] || i18n.en;
  return { lang, translations: { ...dict } };
}

// First-run import of system-backed settings into prefs. The actual truth for
// `openAtLogin` lives in OS login items / autostart files; if we just trusted
// the schema default (false), an upgrading user with login-startup already
// enabled would silently lose it the first time prefs is saved. So on first
// boot after this field exists in the schema, copy the system value INTO prefs
// and mark it hydrated. After that, prefs is the source of truth and the
// openAtLogin pre-commit gate handles future writes back to the system.
//
// MUST run inside app.whenReady() — Electron's app.getLoginItemSettings() is
// only stable after the app is ready. MUST run before createWindow() so the
// first menu render reads the hydrated value.
function hydrateSystemBackedSettings() {
  if (_settingsController.get("openAtLoginHydrated")) return;
  let systemValue = false;
  try {
    systemValue = !!_readSystemOpenAtLogin();
  } catch (err) {
    console.warn("Duck: failed to read system openAtLogin during hydration:", err && err.message);
  }
  const result = _settingsController.hydrate({
    openAtLogin: systemValue,
    openAtLoginHydrated: true,
  });
  if (result && result.status === "error") {
    console.warn("Duck: openAtLogin hydration failed:", result.message);
  }
}

// First-run only: seed the UI language from the device locale. A brand-new
// install has no prefs file, so `lang` would otherwise sit at the schema default
// ("en") regardless of the user's OS language. Gated on _initialPrefsLoad.fresh
// (missing-file load) so a RETURNING user's chosen language is never touched.
// MUST run inside app.whenReady() — app.getLocale() is only stable after ready —
// and before createWindow() so the first menu/tray render is already localized.
function hydrateFreshInstallLanguage() {
  if (!_initialPrefsLoad || !_initialPrefsLoad.fresh) return;
  let detected = "en";
  try {
    detected = prefsModule.mapLocaleToLang(app.getLocale());
  } catch (err) {
    console.warn("Duck: failed to detect device locale for language:", err && err.message);
    return;
  }
  if (detected && detected !== _settingsController.get("lang")) {
    _settingsController.applyUpdate("lang", detected);
  }
}

// Capture window/mini runtime state into the controller and write to disk.
// Replaces the legacy `savePrefs()` callsites — they used to read fresh
// `win.getBounds()` and `_mini.*` at save time, so we mirror that here.
function flushRuntimeStateToPrefs() {
  if (!win || win.isDestroyed()) return;
  const bounds = getPetWindowBounds();
  const theme = getActiveTheme();
  // #408: persist the frozen keep-size, not the live window bounds — otherwise a
  // bounds value inflated by a DPI flux gets saved and restored on relaunch.
  const isFrozenActive = keepSizeAcrossDisplaysCached && isProportionalMode();
  const persistPx = isFrozenActive
    ? getEffectiveCurrentPixelSize()
    : { width: bounds.width, height: bounds.height };
  // #408 round-2: also persist the frozen-origin work area (kept independent
  // of positionDisplay; see the schema comment on savedPixelWorkArea). Calling
  // getEffectiveCurrentPixelSize above already lazy-seeded the origin if it
  // wasn't seeded yet.
  const persistOriginWa = isFrozenActive
    ? (keepSizeFrozenOriginWa
        ? { width: keepSizeFrozenOriginWa.width, height: keepSizeFrozenOriginWa.height }
        : null)
    : null;
  _settingsController.applyBulk({
    x: bounds.x,
    y: bounds.y,
    positionSaved: true,
    positionThemeId: theme ? theme._id : "",
    positionVariantId: theme ? theme._variantId : "",
    positionDisplay: captureCurrentDisplaySnapshot(bounds),
    savedPixelWidth: persistPx.width,
    savedPixelHeight: persistPx.height,
    savedPixelWorkArea: persistOriginWa,
    size: currentSize,
    miniMode: _mini.getMiniMode(),
    miniEdge: _mini.getMiniEdge(),
    preMiniX: _mini.getPreMiniX(),
    preMiniY: _mini.getPreMiniY(),
  });
}

// Snapshot the display the pet is currently on so the next launch can tell
// whether the same physical monitor is still attached (see startup regularize
// logic below). Returns null if screen.* is unavailable — any truthy snapshot
// here unlocks the "trust saved position" path, so we fail closed.
function captureCurrentDisplaySnapshot(bounds) {
  try {
    const display = screen.getDisplayNearestPoint({
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    });
    return buildDisplaySnapshot(display);
  } catch {
    return null;
  }
}

function safeConsoleError(...args) {
  try {
    console.error(...args);
  } catch (err) {
    try {
      const line = `${new Date().toISOString()} ${args.map((x) => String(x)).join(" ")}\n`;
      fs.appendFileSync(path.join(app.getPath("userData"), "duck-main.log"), line);
    } catch {}
  }
}

// ── Theme loader ──
const themeLoader = require("./shell/theme-loader");
const createCodexPetMain = require("./state/codex-pet-main");
themeLoader.init(__dirname, app.getPath("userData"));
themeRuntime = createThemeRuntime({
  themeLoader,
  settingsController: _settingsController,
  fs,
  path,
  getRenderWindow: () => win,
  getHitWindow: () => hitWin,
  getStateRuntime: () => _state,
  getTickRuntime: () => _tick,
  getMiniRuntime: () => _mini,
  getAnimationOverridesRuntime: () => animationOverridesMain,
  getFadeSequencer: () => themeFadeSequencer,
  getPetWindowBounds,
  applyPetWindowBounds,
  computeFinalDragBounds,
  clampToScreenVisual,
  flushRuntimeStateToPrefs,
  syncHitStateAfterLoad,
  syncRendererStateAfterLoad,
  syncHitWin,
  syncSessionHudVisibility: () => syncSessionHudVisibility(),
  startMainTick: () => startMainTick(),
  invalidateDisplayedVisual: (detail) => resetDisplayedVisualProjection(detail),
  refreshDisplayedVisualHitBoxes: () => refreshDisplayedVisualHitBoxes(),
  bumpAnimationOverridePreviewPosterGeneration,
  rebuildAllMenus: () => rebuildAllMenus(),
  isManagedTheme: (themeId) => codexPetMain && codexPetMain.isManagedTheme(themeId),
});
themeLoader.bindActiveThemeRuntime(themeRuntime);

function getActiveTheme() {
  return themeRuntime ? themeRuntime.getActiveTheme() : null;
}

let animationOverridesMain = null;
function bumpAnimationOverridePreviewPosterGeneration() {
  return animationOverridesMain && animationOverridesMain.bumpPreviewPosterGeneration();
}
function maybeDestroyIdleAnimationPreviewPosterWindow() {
  if (animationOverridesMain) animationOverridesMain.maybeDestroyIdlePreviewPosterWindow();
}

let roamFencePickerRuntime = null;
let labJobs = null;
let duckActionStatus = { ready:false, busy:true };
function getLabJobs() {
  if (!labJobs) {
    const modulePath = app.isPackaged ? path.join(process.resourcesPath, "robot-lab-mcp/jobs.cjs") : path.join(__dirname, "../mcp/robot-lab/jobs.cjs");
    labJobs = require(modulePath).createLabJobs();
  }
  return labJobs;
}
function duckActionCatalog() {
  return getLabJobs().actions().map(action => ({ ...action, url: `pet-model://policy/${encodeURIComponent(`lab/${action.id}/policy.onnx`)}` }));
}
const robotLabRuntime = require("./shell/robot-lab-window").createRobotLabWindow({
  app, BrowserWindow, ipcMain, dialog, getJobs: getLabJobs,
  onWindowChanged: () => applyDockVisibility(),
  onActionsChange: () => { sendToRenderer('duck-actions-change', duckActionCatalog()); rebuildAllMenus(); },
  onApply: async (url) => {
    if (win && !win.isDestroyed()) win.webContents.send("duck-walk-policy-change", url);
  },
});
_settingsController.subscribeKey("developerMode", (enabled) => {
  if (enabled) robotLabRuntime.open();
  else robotLabRuntime.close();
});
const settingsWindowRuntime = createSettingsWindowRuntime({
  app,
  BrowserWindow,
  fs,
  isWin,
  nativeTheme,
  path,
  getPetWindowBounds: () => getPetWindowBounds(),
  getNearestWorkArea: (cx, cy) => getNearestWorkArea(cx, cy),
  getTextScale: (bounds) => effectiveTextScaleForKey(
    getDisplayKeyForBounds(bounds) || getSettingsDisplayKey()
  ),
  getSavedBounds: () => _settingsController.get("settingsWindowBounds"),
  onSaveBounds: (bounds) => _settingsController.applyUpdate("settingsWindowBounds", bounds),
  getTitle: () => translate("settingsWindowTitle"),
  onBeforeCreate: () => bumpAnimationOverridePreviewPosterGeneration(),
  onBeforeClosed: () => {
    if (roamFencePickerRuntime) roamFencePickerRuntime.cancel();
    bumpAnimationOverridePreviewPosterGeneration();
    if (shortcutRuntime) shortcutRuntime.stopRecording();
    void settingsSizePreviewSession.cleanup();
    // The renderer-side rollback (slider blur / control dispose) rides IPC
    // and can't be trusted while the window is being torn down — without
    // this, closing mid-drag leaves the transient preview scale applied to
    // the display until the next commit or restart.
    endTextScalePreview();
  },
  onAfterClosed: () => maybeDestroyIdleAnimationPreviewPosterWindow(),
});

const permissionAutomationConfirmationRuntime = createPermissionAutomationConfirmationRuntime({
  BrowserWindow,
  ipcMain,
  nativeTheme,
  screen,
  path,
  iconPath: settingsWindowRuntime.getIconPath(),
});

function getSettingsWindow() {
  return settingsWindowRuntime.getWindow();
}

// The file loader is shared by roam and Settings. A selection saved from the
// visual picker therefore updates the exact same last-known-good cache that a
// later walk reads; external tools keep using the same JSON contract.
const roamFenceLoader = createRoamFenceLoader();
const roamFenceSettings = createRoamFenceSettings({ loader: roamFenceLoader });
roamFencePickerRuntime = createRoamFencePicker({
  BrowserWindow,
  ipcMain,
  nativeTheme,
  screen,
  path,
  iconPath: settingsWindowRuntime.getIconPath(),
  getSettingsWindow,
  getPetWindowBounds: () => getPetWindowBounds(),
  getEffectivePetSize: (workArea) => getEffectiveCurrentPixelSize(workArea),
});

shortcutRuntime = createShortcutRuntime({
  ipcMain,
  globalShortcut,
  settingsController: _settingsController,
  getSettingsWindow,
  shortcutHandlers,
});

// The injected window/menu closures below are intentionally lazy. During
// startup before themeRuntime / win / Settings window / rebuildAllMenus exist,
// only the sync/summary/merge methods are safe to call.
codexPetMain = createCodexPetMain({
  app,
  BrowserWindow,
  dialog,
  fs,
  getActiveTheme: () => getActiveTheme(),
  getLang: () => lang,
  getMainWindow: () => win,
  getSettingsWindow,
  path,
  reloadActiveTheme: () => themeRuntime.reloadActiveTheme(),
  rebuildAllMenus: () => rebuildAllMenus(),
  settingsController: _settingsController,
  shell,
  themeLoader,
});
const REGISTER_PROTOCOL_DEV_ARG = codexPetMain.REGISTER_PROTOCOL_DEV_ARG;
// Lenient load so a missing/corrupt user-selected theme can't brick boot.
// If lenient fell back to "duck" OR the variant fell back to "default",
// hydrate prefs to match so the store stays truth.
//
// Startup runs BEFORE the window is ready, so we call the runtime's initial
// load path, not activateTheme (which requires ready windows) and not the
// setThemeSelection command (which goes through activateTheme). The runtime
// switch path via UI goes through setThemeSelection post-window-ready.
let _requestedThemeId = _settingsController.get("theme") || "duck";
const _initialVariantMap = _settingsController.get("themeVariant") || {};
let _requestedVariantId = _initialVariantMap[_requestedThemeId] || "default";
const _initialThemeOverrides = _settingsController.get("themeOverrides") || {};
let _requestedThemeOverrides = _initialThemeOverrides[_requestedThemeId] || null;
let _startupCodexPetSyncSummary = codexPetMain.syncThemes(_requestedThemeId);
if (codexPetMain.summaryHasActiveOrphan(_startupCodexPetSyncSummary, _requestedThemeId)) {
  const orphanThemeId = _requestedThemeId;
  const nextVariantMap = { ...(_settingsController.get("themeVariant") || {}) };
  const nextOverrides = { ...(_settingsController.get("themeOverrides") || {}) };
  delete nextVariantMap[orphanThemeId];
  delete nextOverrides[orphanThemeId];

  _requestedThemeId = "duck";
  _requestedVariantId = nextVariantMap[_requestedThemeId] || "default";
  _requestedThemeOverrides = nextOverrides[_requestedThemeId] || null;
  const result = _settingsController.hydrate({
    theme: _requestedThemeId,
    themeVariant: nextVariantMap,
    themeOverrides: nextOverrides,
  });
  if (result && result.status === "error") {
    console.warn("Duck: Codex Pet active theme fallback hydrate failed:", result.message);
  }
  _startupCodexPetSyncSummary = codexPetMain.mergeSyncSummaries(
    _startupCodexPetSyncSummary,
    codexPetMain.syncThemes(_requestedThemeId)
  );
  codexPetMain.setLastSyncSummary(_startupCodexPetSyncSummary);
}
const _loadedStartupTheme = themeRuntime.loadInitialTheme(_requestedThemeId, {
  variant: _requestedVariantId,
  overrides: _requestedThemeOverrides,
});
if (_loadedStartupTheme._id !== _requestedThemeId || _loadedStartupTheme._variantId !== _requestedVariantId) {
  const nextVariantMap = { ...(_settingsController.get("themeVariant") || {}) };
  // Self-heal: store the resolved ids so next boot doesn't fall back again.
  nextVariantMap[_loadedStartupTheme._id] = _loadedStartupTheme._variantId;
  if (_loadedStartupTheme._id !== _requestedThemeId) {
    delete nextVariantMap[_requestedThemeId];
  }
  const result = _settingsController.hydrate({
    theme: _loadedStartupTheme._id,
    themeVariant: nextVariantMap,
  });
  if (result && result.status === "error") {
    console.warn("Duck: theme hydrate after fallback failed:", result.message);
  }
}

// ── Pet window geometry / bounds runtime ──
// Geometry's startup/theme-swap fallback only. It must stay a pure read:
// Slot candidates commit to canonical state, so using one here would let a
// hit-window sync install a payload resolved from its own
// wall clock — the midnight/holiday race the canonical payload exists to end.
function getEffectivePetAccessoryPayloads(activeTheme = getActiveTheme()) {
  const snapshot = _settingsController.getSnapshot();
  const headId = getEffectivePetAccessoryIdForTheme({
    petAccessory: snapshot.petAccessory,
    holidayAccessoryEnabled: snapshot.holidayAccessoryEnabled,
    themeId: activeTheme && activeTheme._id,
  });
  const mouthId = getPetMouthAccessoryIdForTheme(
    snapshot.petMouthAccessory,
    activeTheme && activeTheme._id
  );
  return {
    head: buildPetAccessoryPayload(headId, activeTheme),
    mouth: buildPetMouthAccessoryPayload(mouthId, activeTheme),
  };
}

function getEffectivePetAccessoryIds() {
  const activeTheme = getActiveTheme();
  const canonical = getPetAccessorySlotsSnapshot(activeTheme);
  const payloads = canonical ? canonical.payloads : getEffectivePetAccessoryPayloads();
  return Object.freeze({
    head: payloads.head.id,
    mouth: payloads.mouth.id,
  });
}

function prepareCurrentAccessorySlotsDelivery(activeTheme = getActiveTheme()) {
  return preparePetAccessorySlotsDelivery(
    getEffectivePetAccessoryPayloads(activeTheme),
    activeTheme
  );
}

function deliverAccessorySlotsSnapshot(activeTheme = getActiveTheme()) {
  const delivery = prepareCurrentAccessorySlotsDelivery(activeTheme);
  const candidate = delivery.snapshot;
  const delivered = sendToRenderer("pet-accessory-slots-change", candidate);
  if (!finalizePetAccessorySlotsDelivery(delivery, delivered)) return false;
  const geometry = describeGeometrySync(syncHitWin());
  if (geometry.applied) {
    try { repositionAnchoredFloatingSurfaces(); } catch {}
  }
  return true;
}

// Composed accessory facing as the renderer actually applied it (mini-left
// stage XOR asset-direction stage). Defaults to unmirrored until the first
// report; that matches the pre-accessory-hitbox behaviour.
let _accessoryMirrored = false;
function setAccessoryMirrored(mirrored) {
  const next = !!mirrored;
  if (_accessoryMirrored === next) return;
  _accessoryMirrored = next;
  syncHitWin();
}

let _petIpc = null; // duck-on-desk: pet-interaction-ipc handle (lift fall = protected period)
const petWindowRuntime = createPetWindowRuntime({
  screen,
  isWin,
  isMac,
  isLinux,
  windowsHitWindowFocusable: _hitWindowActivationRuntime.windowsHitWindowFocusable,
  linuxWindowType: LINUX_WINDOW_TYPE,
  topmostLevel: WIN_TOPMOST_LEVEL,
  getRenderWindow: () => win,
  getHitWindow: () => hitWin,
  getSettingsWindow: () => getSettingsWindow(),
  getActiveTheme: () => getActiveTheme(),
  getDisplayedVisual: () => getDisplayedVisualTuple(),
  getCurrentState: () => getDisplayedVisualTuple().displayState,
  getCurrentSvg: () => getDisplayedVisualTuple().file,
  getCurrentHitBox: () => getDisplayedVisualTuple().hitBox,
  getCurrentAccessoryPayloads: getEffectivePetAccessoryPayloads,
  getAccessoryMirrored: () => _accessoryMirrored,
  getMiniMode: () => _mini.getMiniMode(),
  getMiniTransitioning: () => _mini.getMiniTransitioning(),
  getMiniContainedSeam: () => _mini.getContainedSeam(),
  getMiniPeekOffset: () => _mini.PEEK_OFFSET,
  getCurrentPixelSize: () => getCurrentPixelSize(),
  getEffectiveCurrentPixelSize: (workArea) => getEffectiveCurrentPixelSize(workArea),
  getAllowEdgePinning: () => allowEdgePinningCached,
  getPrimaryWorkAreaSafe: () => getPrimaryWorkAreaSafe(),
  getNearestWorkArea,
  sendToRenderer,
  keepOutOfTaskbar,
  repositionSessionHud: () => repositionSessionHud(),
  repositionAnchoredSurfaces: () => repositionAnchoredFloatingSurfaces(),
  // #640: hitbox changes without a window move (state switch, theme reload)
  // must re-answer the editing-overlap question. (Lazy — defined below.)
  syncImeEditingPetDodge: () => topmostRuntime.syncImeEditingPetDodge(),
  repositionFloatingBubbles: () => repositionFloatingBubbles(),
  showFloatingSurfacesForPet: () => floatingWindowRuntime.showFloatingSurfacesForPet(),
  hideFloatingSurfacesForPet: () => floatingWindowRuntime.hideFloatingSurfacesForPet(),
  setFloatingSurfacesFullscreenSuppressed: (suppressed) => (
    floatingWindowRuntime.setFullscreenSuppressedForPet(suppressed)
  ),
  // Lazy-bound like isMiniAnimating below — topmostRuntime is constructed
  // after petWindowRuntime, but this closure only fires on a user gesture,
  // well after module load finishes. (#935 override latch)
  noteManualPetShow: () => topmostRuntime.noteFullscreenAutoHideOverride(),
  syncSessionHudVisibilityAndBubbles: () => syncSessionHudVisibilityAndBubbles(),
  syncPermissionShortcuts: () => syncPermissionShortcuts(),
  buildTrayMenu: () => buildTrayMenu(),
  buildContextMenu: () => buildContextMenu(),
  reapplyMacVisibility: () => reapplyMacVisibility(),
  reassertWinTopmost: (...args) => reassertWinTopmost(...args),
  scheduleHwndRecovery: () => scheduleHwndRecovery(),
  cloakInspector: _cloakInspector,
  isMiniAnimating: () => _mini.getIsAnimating(),
  // Issue #690 plan §4.3.10's fourth reconcile protection period (lazy-bound
  // like isMiniAnimating above — _roam is constructed after petWindowRuntime,
  // but this closure isn't invoked until well after module load finishes).
  isRoamAnimating: () => _roam.isRoamAnimating() || (_petIpc !== null && _petIpc.isDuckLiftFalling()),
  isNearWorkAreaEdge: (bounds) => isNearWorkAreaEdge(bounds),
  flushRuntimeStateToPrefs: () => flushRuntimeStateToPrefs(),
  handleMiniDisplayChange: () => _mini.handleDisplayChange(),
  // Issue #690 plan §4.5 point 4.5-4: handleDisplayMetricsChanged() used to
  // silently swallow topology changes that land mid-mini-transition (the
  // `if (getMiniTransitioning()) return;` guard). Instead it now hands off to
  // mini.js so the change isn't lost — mini marks pendingTopologyMaterialize
  // and does exactly one final re-materialize against fresh topology at
  // whichever of its own three transition-end points comes next.
  notifyMiniTopologyChangedDuringTransition: () => _mini.notifyTopologyChangedDuringTransition(),
  exitMiniMode: () => exitMiniMode(),
});

function getObjRect(bounds) {
  return petWindowRuntime.getObjRect(bounds);
}

function getAssetPointerPayload(bounds, point) {
  return petWindowRuntime.getAssetPointerPayload(bounds, point);
}

let win;
let hitWin;  // input window — small opaque rect over hitbox, receives all pointer events

// Tray icon flash state
let trayFlashTimer = null;
let trayFlashStopTimer = null;
let trayFlashNormalIcon = null;
let trayFlashHighlightIcon = null;
let tray = null;
let contextMenuOwner = null;
// Mirror of _settingsController.get("size") — initialized from disk, kept in
// sync by the settings subscriber. The legacy S/M/L → P:N migration runs
// inside createWindow() because it needs the screen API.
let currentSize = _settingsController.get("size");

// ── Proportional size mode ──
// currentSize = "P:<ratio>" means the pet occupies <ratio>% of the display long edge,
// so rotating the same monitor to portrait does not suddenly shrink the pet.
const PROPORTIONAL_RATIOS = [8, 10, 12, 15];

function isProportionalMode(size) {
  return typeof (size || currentSize) === "string" && (size || currentSize).startsWith("P:");
}

function getProportionalRatio(size) {
  return parseFloat((size || currentSize).slice(2)) || 10;
}

function getPixelSizeFor(sizeKey, overrideWa) {
  if (!isProportionalMode(sizeKey)) return SIZES[sizeKey] || SIZES.S;
  const ratio = getProportionalRatio(sizeKey);
  let wa = overrideWa;
  if (!wa && win && !win.isDestroyed()) {
    const { x, y, width, height } = getPetWindowBounds();
    wa = getNearestWorkArea(x + width / 2, y + height / 2);
  }
  if (!wa) wa = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
  return getProportionalPixelSize(ratio, wa);
}

function getCurrentPixelSize(overrideWa) {
  if (!isProportionalMode()) return SIZES[currentSize] || SIZES.S;
  return getPixelSizeFor(currentSize, overrideWa);
}

// #408: while keepSizeAcrossDisplays is ON, the frozen pixel size is held in
// memory (keepSizeFrozenPx) rather than re-read from win.getBounds() on every
// access. Re-reading the live bounds let a transiently-wrong value during a
// Windows sleep/wake DPI flux get laundered back through setBounds(), ratcheting
// the pet larger each cycle ("the longer it sleeps, the bigger it gets"). Seeded
// at launch and lazily on first use; cleared (→ re-seeded from the proportional
// size) whenever the size or the keepSize toggle changes.
let keepSizeFrozenPx = null;
// #408 round-2: track the *origin* display's work area alongside the frozen
// pixel size so a legitimate cross-display keep-size (set on a large display,
// later moved to a smaller one via "Send to display") is not mis-clamped on
// the next launch — positionDisplay tracks the LAST-FLUSH display, which after
// a send diverges from the actual frozen origin. Lifecycle mirrors
// keepSizeFrozenPx (lazy-seeded together, reset together, persisted together).
let keepSizeFrozenOriginWa = null;

function resetKeepSizeFrozen() {
  keepSizeFrozenPx = null;
  keepSizeFrozenOriginWa = null;
}

function snapshotKeepSizeOriginWa(wa) {
  if (!wa || typeof wa !== "object") return null;
  const w = Number(wa.width);
  const h = Number(wa.height);
  if (!Number.isFinite(w) || w <= 0) return null;
  if (!Number.isFinite(h) || h <= 0) return null;
  return { width: w, height: h };
}

function getEffectiveCurrentPixelSize(overrideWa) {
  if (keepSizeAcrossDisplaysCached && isProportionalMode()) {
    // #408: seed from the CURRENT display's proportional size, never from an
    // overrideWa — callers like sendToDisplay/bringPetToPrimaryDisplay pass a
    // *target* display's work area, and seeding from that would freeze the
    // pet at the target's proportional size instead of its realized size.
    if (!keepSizeFrozenPx) {
      // Mirror getPixelSizeFor's wa resolution so the captured origin matches
      // the display we actually sized from.
      let seedWa = null;
      if (win && !win.isDestroyed()) {
        const { x, y, width, height } = getPetWindowBounds();
        seedWa = getNearestWorkArea(x + width / 2, y + height / 2);
      }
      if (!seedWa) seedWa = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
      keepSizeFrozenPx = getProportionalPixelSize(getProportionalRatio(), seedWa);
      keepSizeFrozenOriginWa = snapshotKeepSizeOriginWa(seedWa);
    }
    return { width: keepSizeFrozenPx.width, height: keepSizeFrozenPx.height };
  }
  return getCurrentPixelSize(overrideWa);
}
let contextMenu;
let doNotDisturb = false;
let isQuitting = false;
let quitCleanupStarted = false;
// Mirror caches: kept in sync with the settings store via settings-effect-router
// further down. Read freely; never assign
// directly (writes go through ctx setters → controller.applyUpdate).
let showTray = _settingsController.get("showTray");
let showDock = _settingsController.get("showDock");
let manageClaudeHooksAutomatically = _settingsController.get("manageClaudeHooksAutomatically");
let autoStartWithClaude = _settingsController.get("autoStartWithClaude");
let openAtLogin = _settingsController.get("openAtLogin");
let bubbleFollowPet = _settingsController.get("bubbleFollowPet");
let bubbleFollowPreference = _settingsController.get("bubbleFollowPreference");
let bubbleFixedCorner = _settingsController.get("bubbleFixedCorner");
let sessionHudEnabled = _settingsController.get("sessionHudEnabled");
let sessionHudShowStateLabels = _settingsController.get("sessionHudShowStateLabels");
let sessionHudShowElapsed = _settingsController.get("sessionHudShowElapsed");
let sessionHudShowContextUsage = _settingsController.get("sessionHudShowContextUsage");
let claudeQuotaCollectionEnabled = _settingsController.get("claudeQuotaCollectionEnabled");
let sessionHudCleanupDetached = _settingsController.get("sessionHudCleanupDetached");
let sessionHudPinned = _settingsController.get("sessionHudPinned");
let sessionStaleMs = _settingsController.get("sessionStaleMs");
let workingStaleMs = _settingsController.get("workingStaleMs");
let codexWorkingStaleMs = _settingsController.get("codexWorkingStaleMs");
let detachedIdleStaleMs = _settingsController.get("detachedIdleStaleMs");
let soundMuted = _settingsController.get("soundMuted");
let soundVolume = _settingsController.get("soundVolume");
let lowPowerIdleMode = _settingsController.get("lowPowerIdleMode");
let keepAwakeWhileWorking = _settingsController.get("keepAwakeWhileWorking");
let petTint = _settingsController.get("petTint");
let allowEdgePinningCached = _settingsController.get("allowEdgePinning");
let disableMiniModeCached = _settingsController.get("disableMiniMode");
let keepSizeAcrossDisplaysCached = _settingsController.get("keepSizeAcrossDisplays");
let fullscreenOverlayCached = _settingsController.get("fullscreenOverlay");
let fullscreenAutoHideCached = _settingsController.get("fullscreenAutoHide");
let textScale = _settingsController.get("textScale");
let textScaleByDisplay = _settingsController.get("textScaleByDisplay");
// Transient slider-drag override for ONE display — the one the settings
// window sits on (what you see is what you tune). Applied to live windows but
// never written to the store; cleared on commit (mirror setters) or rollback
// (endTextScalePreview).
let textScalePreview = null; // { key: string, value: number }

function getDisplayKeyForBounds(bounds) {
  if (!bounds) return null;
  try {
    const display = screen.getDisplayMatching(bounds);
    return display && display.id != null ? String(display.id) : null;
  } catch {
    return null;
  }
}

function getPetDisplayKey() {
  // Resolve from the pet's CENTER POINT, not the window rect: the pet windows
  // use enableLargerThanScreen and can overhang display edges, which makes
  // getDisplayMatching unstable. Nearest-point matches the same anchor the
  // bubble/HUD geometry uses (getNearestWorkArea of the pet center), so the
  // zoom value and the layout always agree on which display they are on.
  try {
    const bounds = getPetWindowBounds();
    if (!bounds) return null;
    const point = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
    const display = screen.getDisplayNearestPoint(point);
    return display && display.id != null ? String(display.id) : null;
  } catch {
    return null;
  }
}

function getWindowDisplayKey(win) {
  if (!win || typeof win.isDestroyed !== "function" || win.isDestroyed()) return null;
  try { return getDisplayKeyForBounds(win.getBounds()); } catch { return null; }
}

function getSettingsDisplayKey() {
  return getWindowDisplayKey(settingsWindowRuntime.getWindow()) || getPetDisplayKey();
}

function effectiveTextScaleForKey(key) {
  if (textScalePreview && key && textScalePreview.key === key) {
    return clampTextScale(textScalePreview.value);
  }
  return resolveTextScaleForKey(textScaleByDisplay, textScale, key);
}

// Pet-anchored floating windows (permission bubbles, update bubble, session
// HUD) all read the scale of whichever display the pet is on right now.
function getTextScaleForPetWindows() {
  return effectiveTextScaleForKey(getPetDisplayKey());
}

// textScale changed (commit, preview tick, or display change): the resizable
// windows re-zoom themselves against their own display, and the pet-anchored
// floating windows re-resolve scale + re-inject zoom inside their reposition
// paths (applyZoomToWindow memoizes, so this is cheap to call broadly).
function applyTextScaleNow() {
  try {
    if (settingsWindowRuntime && typeof settingsWindowRuntime.applyTextScaleToWindow === "function") {
      settingsWindowRuntime.applyTextScaleToWindow();
    }
  } catch (err) {
    console.warn("Duck: settings window text scale failed:", err && err.message);
  }
  try {
    if (_dashboard && typeof _dashboard.applyTextScaleToWindow === "function") {
      _dashboard.applyTextScaleToWindow();
    }
  } catch (err) {
    console.warn("Duck: dashboard text scale failed:", err && err.message);
  }
  repositionAnchoredFloatingSurfaces();
}

function previewTextScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    textScalePreview = null;
  } else {
    const key = getSettingsDisplayKey();
    textScalePreview = key ? { key, value: clampTextScale(n) } : null;
  }
  applyTextScaleNow();
  return { status: "ok" };
}

function endTextScalePreview() {
  if (!textScalePreview) return { status: "ok", noop: true };
  textScalePreview = null;
  applyTextScaleNow();
  return { status: "ok" };
}

function getRuntimeBubblePolicy(kind) {
  return getBubblePolicy(_settingsController.getSnapshot(), kind);
}

function getAllBubblesHidden() {
  return isAllBubblesHidden(_settingsController.getSnapshot());
}

let macHideController = null; // macOS app-hidden ↔ pet visibility bridge (#416); created in whenReady
// Shared mac prep for any manual "show / move the pet" entry point (tray,
// shortcut, bring-to-primary): release OS-hide ownership so a later
// activate/unhide won't falsely restore, and if the app is OS-hidden, unhide it
// first to avoid a "window shown but app still hidden" limbo.
function prepManualPetVisibility() {
  if (macHideController) macHideController.noteManualChange();
  if (isMac && petWindowRuntime.isPetHidden() && typeof app.isHidden === "function" && app.isHidden()) {
    try { app.show(); } catch (_) {}
  }
}
function togglePetVisibility() {
  prepManualPetVisibility();
  return petWindowRuntime.togglePetVisibility();
}
// Explicit-direction variant for the menus: the Show/Hide Pet items apply the
// intent their label carried when the menu was built, so a state change that
// lands while the menu is open degrades to a no-op instead of inverting the
// action (see menu.js).
function setPetVisibility(visible) {
  prepManualPetVisibility();
  return petWindowRuntime.setPetHidden(!visible);
}
function bringPetToPrimaryDisplay() {
  prepManualPetVisibility();
  return petWindowRuntime.bringPetToPrimaryDisplay();
}

function sendRawToRenderer(channel, ...args) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return false;
  win.webContents.send(channel, ...args);
  return true;
}

function inferVisualSource(displayState, file) {
  return displayState === "idle" && file !== _state.getCurrentSvg()
    ? "idle-animation"
    : "state";
}

function requestDisplayedVisual(displayState, file, options = {}) {
  if (!displayedVisualProjection) return null;
  const activeTheme = getActiveTheme();
  return displayedVisualProjection.request({
    themeId: activeTheme && activeTheme._id,
    logicalState: options.logicalState || _state.getCurrentState(),
    displayState,
    file,
    hitBox: _state.resolveHitBoxForSvg(file),
    source: options.source || inferVisualSource(displayState, file),
    deliver: options.deliver || ((payload) => sendRawToRenderer("state-change", payload)),
    onLogicalSettlement: options.onLogicalSettlement,
  });
}

function resetDisplayedVisualProjection(detail = "projection-reset", options = {}) {
  if (!displayedVisualProjection) return false;
  const activeTheme = getActiveTheme();
  displayedVisualProjection.reset({
    themeId: activeTheme && activeTheme._id,
    logicalState: _state.getCurrentState(),
    detail,
    preserveCommitted: options.preserveCommitted === true,
  });
  if (options.preserveCommitted !== true) {
    lastAppliedVisualGeneration = 0;
  }
  return true;
}

function refreshDisplayedVisualHitBoxes() {
  if (!displayedVisualProjection) return false;
  const refreshed = displayedVisualProjection.refreshHitBoxes(
    (file) => _state.resolveHitBoxForSvg(file)
  );
  if (!refreshed) return false;
  lastAppliedVisualGeneration = 0;
  return syncDisplayedVisualGeometry();
}

function refreshDisplayedVisualForLowPowerMode() {
  const activeTheme = getActiveTheme();
  const state = _state.getCurrentState();
  const file = _state.getCurrentSvg();
  const override = activeTheme
    && activeTheme.rendering
    && activeTheme.rendering.lowPowerStaticImageOverrides
    && activeTheme.rendering.lowPowerStaticImageOverrides[state];
  if (!override || override.from !== file || !override.to) return false;
  return !!requestDisplayedVisual(state, file, {
    logicalState: state,
    source: "state",
  });
}

function isVisualGenerationCurrent(visualGeneration) {
  if (!displayedVisualProjection || !Number.isSafeInteger(visualGeneration)) return false;
  const snapshot = displayedVisualProjection.getSnapshot();
  const current = snapshot.requested || snapshot.committed;
  return !!(current && current.visualGeneration === visualGeneration);
}

function resolveDragReactionFile(direction) {
  const theme = getActiveTheme();
  const drag = theme && theme.reactions && theme.reactions.drag;
  if (!drag || typeof drag !== "object") return null;
  if (direction === "left" && typeof drag.fileLeft === "string") return drag.fileLeft;
  if (direction === "right" && typeof drag.fileRight === "string") return drag.fileRight;
  return typeof drag.file === "string" ? drag.file : null;
}

function requestDragReaction(direction) {
  const normalizedDirection = direction === "left" || direction === "right" ? direction : null;
  const file = resolveDragReactionFile(normalizedDirection);
  if (!file) return null;
  const snapshot = displayedVisualProjection.getSnapshot();
  const activeReaction = snapshot.requested || snapshot.committed;
  if (activeReaction && activeReaction.source === "reaction" && activeReaction.file === file) {
    sendRawToRenderer("start-drag-reaction", null, normalizedDirection);
    return activeReaction;
  }
  return requestDisplayedVisual(_state.getCurrentState(), file, {
    source: "reaction",
    deliver: (payload) => sendRawToRenderer("start-drag-reaction", payload, normalizedDirection),
  });
}

function requestClickReaction(file, duration) {
  const activeTheme = getActiveTheme();
  if (!activeTheme || !collectRequiredAssetFiles(activeTheme).includes(file)) return null;
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return requestDisplayedVisual(_state.getCurrentState(), file, {
    source: "reaction",
    deliver: (payload) => sendRawToRenderer("play-click-reaction", payload, safeDuration),
  });
}

function sendToRenderer(channel, ...args) {
  if (channel === "state-change") {
    return requestDisplayedVisual(args[0], args[1], args[2] || {});
  }
  return sendRawToRenderer(channel, ...args);
}
function sendToHitWin(channel, ...args) {
  if (hitWin && !hitWin.isDestroyed()) hitWin.webContents.send(channel, ...args);
}
function broadcastSettingsWindow(channel, payload) {
  try {
    const settingsWin = getSettingsWindow();
    if (!settingsWin || settingsWin.isDestroyed()) return;
    if (!settingsWin.webContents || settingsWin.webContents.isDestroyed()) return;
    settingsWin.webContents.send(channel, payload);
  } catch {}
}

function getThemeSoundPreloadUrls() {
  const urls = [];
  for (const name of ["complete", "confirm"]) {
    const url = themeRuntime.getSoundUrl(name);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function syncSoundPreloads() {
  const urls = getThemeSoundPreloadUrls();
  if (urls.length) sendToRenderer("preload-sounds", { urls });
}

function setViewportOffsetY(offsetY) { return petWindowRuntime.setViewportOffsetY(offsetY); }
function getPetWindowBounds() { return petWindowRuntime.getPetWindowBounds(); }
// Issue #690 Phase 3: mini's per-frame applyMiniFrameBounds() needs opts
// (workArea/edgeContext/assertNoYOffset) to actually reach
// petWindowRuntime.applyPetWindowBounds() — this wrapper used to silently
// drop a second argument, which would have made assertNoYOffset a no-op.
function applyPetWindowBounds(bounds, opts) { return petWindowRuntime.applyPetWindowBounds(bounds, opts); }
// PR #751 Codex deep review, rework batch A (coordinator-attributed fix):
// this sibling wrapper had the exact same 2-param bug applyPetWindowBounds
// above was fixed for — topmost-runtime.js's applyFreshNudge() (#525) calls
// applyPetWindowPosition(x, y, { force: true }) specifically so the
// compositor-refresh nudge writes natively even when the materialized
// physical rect already matches current live bounds, but this wrapper
// silently dropped that third argument, making force:true a no-op.
function applyPetWindowPosition(x, y, opts) { return petWindowRuntime.applyPetWindowPosition(x, y, opts); }

function syncHitStateAfterLoad() {
  sendToHitWin("hit-state-sync", {
    currentState: _state.getCurrentState(),
    miniMode: _mini.getMiniMode(),
    dndEnabled: doNotDisturb,
  });
}

function syncRendererStateAfterLoad({ includeStartupRecovery = true } = {}) {
  syncSoundPreloads();
  const activeTheme = getActiveTheme();
  const tintId = getPetTintIdForTheme(petTint, activeTheme && activeTheme._id);
  sendToRenderer("pet-tint-change", resolvePetTintPayload(tintId, activeTheme));
  deliverAccessorySlotsSnapshot(activeTheme);
  sendToRenderer("low-power-idle-mode-change", lowPowerIdleMode);
  if (_mini.getMiniMode()) {
    sendToRenderer("mini-mode-change", true, _mini.getMiniEdge());
    // mini-clip is a renderer inline style — a renderer/theme reload (and
    // startup recovery) drops it. Re-send the current seam clip so a
    // contained mini stays clipped instead of bleeding onto the neighbour.
    _mini.syncContainedClip();
  }
  if (doNotDisturb) {
    sendToRenderer("dnd-change", true);
    if (_mini.getMiniMode()) {
      applyState("mini-sleep");
    } else {
      applyState("sleeping");
    }
    return;
  }
  if (_mini.getMiniMode()) {
    applyState("mini-idle");
    return;
  }

  // Theme hot-reload path (override tweak / variant swap): re-render whatever
  // we were already showing. Going through resolveDisplayState() here flashes
  // "working/typing" when sessions Map still holds a stale session whose
  // state hasn't been stale-downgraded yet — currentState already reflects
  // the user-visible state before reload and stays authoritative.
  if (!includeStartupRecovery) {
    const prev = _state.getCurrentState();
    applyState(prev, getSvgOverride(prev));
    return;
  }

  if (sessions.size > 0) {
    const resolved = resolveDisplayState();
    applyState(resolved, getSvgOverride(resolved));
    return;
  }

  applyState("idle", getSvgOverride("idle"));

  setTimeout(() => {
    if (sessions.size > 0 || doNotDisturb) return;
    detectRunningAgentProcesses((found) => {
      if (found && sessions.size === 0 && !doNotDisturb) {
        _startStartupRecovery();
        resetIdleTimer();
      }
    });
  }, 5000);
}

// ── Sound playback ──
let lastSoundTime = 0;
const SOUND_COOLDOWN_MS = 10000;

function playSound(name) {
  if (soundMuted || doNotDisturb) return;
  const now = Date.now();
  if (now - lastSoundTime < SOUND_COOLDOWN_MS) return;
  const url = themeRuntime.getSoundUrl(name);
  if (!url) return;
  lastSoundTime = now;
  sendToRenderer("play-sound", { url, volume: soundVolume });
}

function resetSoundCooldown() {
  lastSoundTime = 0;
}

function stopTrayFlash() {
  if (trayFlashTimer) {
    clearInterval(trayFlashTimer);
    trayFlashTimer = null;
  }
  if (trayFlashStopTimer) {
    clearTimeout(trayFlashStopTimer);
    trayFlashStopTimer = null;
  }
  const t = _menu.getTray ? _menu.getTray() : null;
  if (t && trayFlashNormalIcon) {
    t.setImage(trayFlashNormalIcon);
  }
}

function flashTaskbar() {
  if (doNotDisturb) return;
  if (!_settingsController.get("flashTaskbarOnComplete")) return;

  const tray = _menu.getTray ? _menu.getTray() : null;
  if (!tray) return;

  // Cache the normal icon on first call
  if (!trayFlashNormalIcon) {
    trayFlashNormalIcon = loadTrayNormalIcon({
      nativeImage,
      platform: process.platform,
      templatePath: path.join(__dirname, "../assets/tray-iconTemplate.png"),
      iconPath: path.join(__dirname, "../assets/icon.png"),
    });
  }

  // Cache the completion icon on first call. macOS uses a dedicated Template
  // pair in the same 18pt slot; Windows/Linux retain the 32px orange dot.
  if (!trayFlashHighlightIcon) {
    trayFlashHighlightIcon = loadTrayFlashIcon({
      nativeImage,
      platform: process.platform,
      flashPath: path.join(__dirname, "../assets/tray-icon-flash.png"),
      flashTemplatePath: path.join(__dirname, "../assets/tray-icon-flashTemplate.png"),
      fileExists: (p) => fs.existsSync(p),
    });
  }

  if (!trayFlashHighlightIcon) return;

  // Clear any existing flash timers
  if (trayFlashTimer) clearInterval(trayFlashTimer);
  if (trayFlashStopTimer) {
    clearTimeout(trayFlashStopTimer);
    trayFlashStopTimer = null;
  }

  const intervalMs = _settingsController.get("flashIntervalMs") || 500;
  const durationMs = _settingsController.get("flashDurationMs");
  // durationMs defaults to 5000; 0 means flash until manually stopped

  let useHighlight = true;
  trayFlashTimer = setInterval(() => {
    if (!_menu.getTray || !_menu.getTray()) {
      stopTrayFlash();
      return;
    }
    const t = _menu.getTray();
    t.setImage(useHighlight ? trayFlashHighlightIcon : trayFlashNormalIcon);
    useHighlight = !useHighlight;
  }, intervalMs);

  // Auto-stop after duration (unless duration is 0 = always)
  if (durationMs !== 0) {
    trayFlashStopTimer = setTimeout(() => {
      stopTrayFlash();
    }, durationMs || 5000);
  }

  // Stop on tray click
  tray.removeAllListeners("click");
  tray.on("click", () => {
    stopTrayFlash();
    tray.removeAllListeners("click");
  });
}

function syncHitWin() { return petWindowRuntime.syncHitWin(); }

function getDisplayedVisualTuple() {
  const committed = displayedVisualProjection
    && displayedVisualProjection.getSnapshot().committed;
  if (committed) return committed;
  return {
    displayState: _state.getCurrentState(),
    file: _state.getCurrentSvg(),
    hitBox: _state.getCurrentHitBox(),
    source: "startup",
    visualGeneration: 0,
  };
}

function syncDisplayedVisualGeometry() {
  const committed = displayedVisualProjection
    && displayedVisualProjection.getSnapshot().committed;
  if (!committed || committed.visualGeneration === lastAppliedVisualGeneration) return true;
  const outcome = describeGeometrySync(syncHitWin());
  if (outcome.applied) lastAppliedVisualGeneration = committed.visualGeneration;
  return outcome.applied;
}

let mouseOverPet = false;
let menuOpen = false;
let idlePaused = false;
let lowPowerIdlePaused = false;
let forceEyeResend = false;
let forceEyeResendBoostUntil = 0;
let requestFastTick = () => {};
let repositionSessionHud = () => {};
let syncSessionHudVisibility = () => {};
let broadcastSessionHudSnapshot = () => {};
let sendSessionHudI18n = () => {};
let getSessionHudReservedOffset = () => 0;
let getSessionHudWindow = () => null;

function getVisibleSessionHudBounds() {
  try {
    const hudWindow = getSessionHudWindow();
    if (
      !hudWindow
      || (typeof hudWindow.isDestroyed === "function" && hudWindow.isDestroyed())
      || (typeof hudWindow.isVisible === "function" && !hudWindow.isVisible())
      || typeof hudWindow.getBounds !== "function"
    ) {
      return [];
    }
    const bounds = hudWindow.getBounds();
    if (
      !bounds
      || !Number.isFinite(bounds.x)
      || !Number.isFinite(bounds.y)
      || !Number.isFinite(bounds.width)
      || bounds.width <= 0
      || !Number.isFinite(bounds.height)
      || bounds.height <= 0
    ) {
      return [];
    }
    return [{ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }];
  } catch {
    return [];
  }
}
const themeFadeSequencer = createThemeFadeSequencer({
  getRenderWindow: () => win,
  getHitWindow: () => hitWin,
  // #640: while the pet dodges an editing bubble its baseline opacity is the
  // faded value, not 1 — restoring to 1 mid-edit would plant an opaque pet on
  // top of the box being typed into. (Lazy: topmostRuntime is defined below.)
  getRestoreOpacity: () => topmostRuntime.getPetTargetOpacity(),
  fadeOutMs: THEME_SWITCH_FADE_OUT_MS,
  fadeInMs: THEME_SWITCH_FADE_IN_MS,
  fallbackMs: THEME_SWITCH_FADE_FALLBACK_MS,
});

function setForceEyeResend(value) {
  forceEyeResend = !!value;
  if (forceEyeResend) {
    forceEyeResendBoostUntil = Math.max(forceEyeResendBoostUntil, Date.now() + 2000);
    requestFastTick(100);
  }
}

function setLowPowerIdlePaused(value) {
  const next = !!value;
  if (lowPowerIdlePaused === next) return;
  lowPowerIdlePaused = next;
  if (!next) setForceEyeResend(true);
}

function beginDragSnapshot() { return petWindowRuntime.beginDragSnapshot(); }
function clearDragSnapshot() { return petWindowRuntime.clearDragSnapshot(); }
function moveWindowForDrag() { return petWindowRuntime.moveWindowForDrag(); }

// Windows-only (#538/#562 drag focus-steal): the topmost runtime calls this
// with the inverse of the fullscreen state. The native controller toggles
// WS_EX_NOACTIVATE without calling BrowserWindow.setFocusable(false), whose
// Focus(false) side effect deactivates the user's fullscreen foreground app.
// Leaving fullscreen removes the native style. When the native controller is
// available, Electron itself remains non-focusable for the hit window's
// lifetime so Chromium cannot explicitly activate Duck on pointerdown. If
// Koffi/user32 initialization failed, construction deliberately falls back to
// the legacy focusable window so desktop click/drag remains available.
const setHitWinFocusable = _hitWindowActivationRuntime.setHitWinFocusable;

// ── Mini Mode — delegated to src/shell/mini.js ──
// Initialized after state module (needs applyState, resolveDisplayState, etc.)
// See _mini initialization below

// ── alwaysOnTop recovery — delegated to src/shell/topmost-runtime.js ──
let permissionPresentationRuntime = null;
const topmostRuntime = createTopmostRuntime({
  isWin,
  isMac,
  getWin: () => win,
  getHitWin: () => hitWin,
  recoverCloakedPet: () => petWindowRuntime.recoverIfCloaked(),
  getPendingPermissions: () => pendingPermissions,
  getPermissionPresentationWindows: () => (
    permissionPresentationRuntime
    && typeof permissionPresentationRuntime.getPermissionPresentationWindows === "function"
      ? permissionPresentationRuntime.getPermissionPresentationWindows()
      : pendingPermissions.map((entry) => entry && entry.bubble).filter(Boolean)
  ),
  getUpdateBubbleWindow: () => _updateBubble.getBubbleWindow(),
  getSessionHudWindow: () => getSessionHudWindow(),
  getContextMenuOwner: () => contextMenuOwner,
  getNearestWorkArea,
  getPetWindowBounds,
  // #640: tight sprite rect for the editing-overlap dodge test
  getHitRectScreen: (bounds) => getHitRectScreen(bounds),
  getShowDock: () => showDock,
  isDragLocked: () => petWindowRuntime.isDragLocked(),
  isMiniAnimating: () => _mini.getIsAnimating(),
  isMiniTransitioning: () => _mini.getMiniTransitioning(),
  isForegroundFullscreen: () => _isForegroundFullscreen(),
  getForegroundFullscreenObservation: () => _isForegroundFullscreen.getLastObservation(),
  isFullscreenWindowAlive: (windowId) => _isForegroundFullscreen.isWindowIdAlive(windowId),
  getFullscreenOverlay: () => fullscreenOverlayCached,
  // #935 fullscreen auto-hide: the pref gate plus pet-window-runtime's
  // dedicated visibility layer (stacked on the user's manual hide).
  getFullscreenAutoHide: () => fullscreenAutoHideCached,
  setFullscreenAutoHidden: (...args) => petWindowRuntime.setFullscreenAutoHidden(...args),
  isFullscreenAutoHidden: () => petWindowRuntime.isFullscreenAutoHidden(),
  setHitWinFocusable,
  keepOutOfTaskbar,
  setForceEyeResend,
  applyPetWindowPosition,
  syncHitWin,
  // I5 (plan §3): report the macOS editing-overlap dodge intent through
  // pet-window-runtime's single ignore-mouse writer instead of this module
  // calling hitWin.setIgnoreMouseEvents() directly.
  setImeEditingPetDodge: (value) => petWindowRuntime.setImeEditingPetDodge(value),
});
const {
  reassertWinTopmost,
  reapplyMacVisibility,
  isNearWorkAreaEdge,
  scheduleHwndRecovery,
  guardAlwaysOnTop,
  startTopmostWatchdog,
  startFocusablePoll,
} = topmostRuntime;

// ── Permission bubble — delegated to src/state/permission.js ──
const {
  createRuntimeAgentGate,
} = require("./state/agent-gate");
const _runtimeAgentGate = createRuntimeAgentGate({
  getSnapshot: () => _settingsController.getSnapshot(),
  // Both unreadable prefs and a writable recovered-defaults snapshot are
  // non-authoritative for this process. The latter may repair the primary file,
  // but only a clean load after restart can re-open agent paths.
  isAuthoritative: () => !_initialPrefsRecovered && !_settingsController.hasReadFailure(),
});
const _permCtx = {
  get win() { return win; },
  get lang() { return lang; },
  get sessions() { return sessions; },
  get bubbleFollowPet() { return bubbleFollowPet; },
  get bubbleFollowPreference() { return bubbleFollowPreference; },
  get bubbleFixedCorner() { return bubbleFixedCorner; },
  get permDebugLog() { return permDebugLog; },
  get doNotDisturb() { return doNotDisturb; },
  get hideBubbles() { return getAllBubblesHidden(); },
  get petHidden() { return petWindowRuntime.isPetEffectivelyHidden(); },
  getBubblePolicy: getRuntimeBubblePolicy,
  getPetWindowBounds,
  getNearestWorkArea,
  getBubbleWorkArea,
  getHitRectScreen,
  getHudReservedOffset: () => getSessionHudReservedOffset(),
  getSessionHudBounds: () => getVisibleSessionHudBounds(),
  getTextScale: (workArea) => getTextScaleForBubbleWorkArea(workArea),
  guardAlwaysOnTop,
  reapplyMacVisibility,
  // #640: permission.js re-runs the editing-overlap dodge scan whenever the
  // pendingPermissions list changes (notifyPermissionsChanged), so a bubble
  // that leaves the list mid-edit can't strand the pet faded + click-through.
  syncImeEditingPetDodge: () => topmostRuntime.syncImeEditingPetDodge(),
  isAgentEnabled: (agentId) => _runtimeAgentGate.isAgentEnabled(agentId),
  isAgentPermissionsEnabled: (agentId) =>
    _runtimeAgentGate.isAgentPermissionsEnabled(agentId),
  isAgentSubagentPermissionsEnabled: (agentId) =>
    _runtimeAgentGate.isAgentSubagentPermissionsEnabled(agentId),
  isCodexPermissionInterceptEnabled: () =>
    _runtimeAgentGate.isCodexPermissionInterceptEnabled(),
  // The permission layer consumes one normalized runtime mode. DND,
  // headless, per-agent and bubble gates run before this chokepoint.
  getPermissionAutomationMode: () =>
    _settingsController.get("permissionAutomationMode") || "off",
  getEffectivePermissionAutomationMode: (entry, options) =>
    sessionAutomationCoordinator
      ? sessionAutomationCoordinator.getEffectiveMode(entry, options)
      : (_settingsController.get("permissionAutomationMode") || "off"),
  hasSessionAutomationOverride: (entry) =>
    !!(
      sessionAutomationCoordinator
      && sessionAutomationCoordinator.getRecordForEntry(entry)
    ),
  canOfferSessionTrust: (entry) =>
    !!(sessionAutomationCoordinator && sessionAutomationCoordinator.canOfferSessionTrust(entry)),
  translate: (key) => translate(key),
  canOfferRemoteSessionTrust: (entry, remote) => {
    const client = remote && remote.client;
    return !!(
      sessionAutomationCoordinator
      && sessionAutomationCoordinator.canOfferSessionTrust(entry)
      && client
      && typeof client.supportsSessionAutomation === "function"
      && client.supportsSessionAutomation()
    );
  },
  requestSessionTrust: (entry) =>
    sessionAutomationCoordinator
      ? sessionAutomationCoordinator.requestEntryTrust(entry)
      : Promise.resolve({ status: "unavailable" }),
  requestRemoteSessionTrust: (entry, remote) =>
    sessionAutomationCoordinator
      ? sessionAutomationCoordinator.requestRemoteSessionTrust(entry, remote)
      : Promise.resolve({ status: "unavailable" }),
  cancelSessionTrustCandidate: (entry, options) =>
    !!(sessionAutomationCoordinator
      && sessionAutomationCoordinator.cancelSessionTrustCandidate(entry, options)),
  focusTerminalForSession: (sessionId, options = {}) => {
    focusDashboardSession(sessionId, {
      requestSource: options.requestSource || "permission-bubble",
      fallbackEntry: options.fallbackEntry || getPendingPermissionFocusEntry(sessionId),
    });
  },
  getSettingsSnapshot: () => _settingsController.getSnapshot(),
  subscribeShortcuts: (cb) => _settingsController.subscribeKey("shortcuts", (_value, snapshot) => {
    if (typeof cb === "function") cb(snapshot);
  }),
  reportShortcutFailure: (actionId, reason) => shortcutRuntime.reportFailure(actionId, reason),
  clearShortcutFailure: (actionId) => shortcutRuntime.clearFailure(actionId),
  repositionFloatingBubbles: () => repositionFloatingBubbles(),
  repositionUpdateBubble: () => repositionUpdateBubble(),
  repositionSessionHud: () => repositionSessionHud(),
  onPermissionResolved: (permEntry, options = {}) => {
    if (!_state || typeof _state.clearPermissionNotification !== "function") return;
    _state.clearPermissionNotification(permEntry && permEntry.sessionId, options);
  },
};
const _perm = initPermission(_permCtx);
permissionPresentationRuntime = _perm;
const { showPermissionBubble, resolvePermissionEntry, sendPermissionResponse, repositionBubbles, permLog, PASSTHROUGH_TOOLS, addPendingPermission, removePendingPermission, isPermissionEntryLive, canAutoResolvePendingPermission, beginSessionTrustConfirmation, endSessionTrustConfirmation, syncPermissionBubbleContent, maybeStartRemoteApproval, clearCodexNotifyBubbles, showCodexUserInputBubble, clearCodexUserInputBubbles, syncPermissionShortcuts, replyOpencodeFamilyPermission, dismissOpencodeFamilyPermissionResolvedExternally } = _perm;
const pendingPermissions = _perm.pendingPermissions;
let permDebugLog = null; // set after app.whenReady()
let updateDebugLog = null; // set after app.whenReady()
let sessionDebugLog = null; // set after app.whenReady()
let focusDebugLog = null; // set after app.whenReady()
let recordWindowsProcessChainShadow = () => false;

function getPendingPermissionFocusEntry(sessionId) {
  const id = String(sessionId || "");
  if (!id) return null;
  const entry = pendingPermissions.find((perm) => perm && perm.sessionId === id && perm.agentId === "codex");
  if (!entry) return null;
  const focusEntry = { id, agentId: entry.agentId };
  if (entry.sourcePid) focusEntry.sourcePid = entry.sourcePid;
  if (entry.wtHwnd) focusEntry.wtHwnd = entry.wtHwnd;
  if (entry.cwd) focusEntry.cwd = entry.cwd;
  if (entry.agentPid) focusEntry.agentPid = entry.agentPid;
  if (entry.pidChain) focusEntry.pidChain = entry.pidChain;
  if (entry.tmuxSocket) focusEntry.tmuxSocket = entry.tmuxSocket;
  if (entry.tmuxClient) focusEntry.tmuxClient = entry.tmuxClient;
  if (entry.orcaPaneKey) focusEntry.orcaPaneKey = entry.orcaPaneKey;
  if (entry.host) focusEntry.host = entry.host;
  if (entry.platform) focusEntry.platform = entry.platform;
  if (entry.model) focusEntry.model = entry.model;
  if (entry.codexOriginator) focusEntry.codexOriginator = entry.codexOriginator;
  if (entry.codexSource) focusEntry.codexSource = entry.codexSource;
  return focusEntry;
}

const _updateBubbleCtx = {
  get win() { return win; },
  get bubbleFollowPet() { return bubbleFollowPet; },
  get bubbleFollowPreference() { return bubbleFollowPreference; },
  get bubbleFixedCorner() { return bubbleFixedCorner; },
  get petHidden() { return petWindowRuntime.isPetEffectivelyHidden(); },
  getBubblePolicy: getRuntimeBubblePolicy,
  getPetWindowBounds,
  getNearestWorkArea,
  getBubbleWorkArea,
  getUpdateBubbleAnchorRect,
  getHitRectScreen,
  getPermissionBubbleBounds: () => _perm.getVisibleBubbleBounds(),
  getSessionHudBounds: () => getVisibleSessionHudBounds(),
  getTextScale: (workArea) => getTextScaleForBubbleWorkArea(workArea),
  guardAlwaysOnTop,
  reapplyMacVisibility,
  clipboard,
};
const _updateBubble = initUpdateBubble(_updateBubbleCtx);
const {
  showUpdateBubble,
  hideUpdateBubble,
  repositionUpdateBubble,
  syncVisibility: syncUpdateBubbleVisibility,
} = _updateBubble;

floatingWindowRuntime = createFloatingWindowRuntime({
  getPendingPermissions: () => pendingPermissions,
  repositionPermissionBubbles: () => repositionBubbles(),
  repositionUpdateBubble: () => repositionUpdateBubble(),
  repositionSessionHud: () => repositionSessionHud(),
  syncSessionHudVisibility: () => syncSessionHudVisibility(),
  syncUpdateBubbleVisibility: (hiddenOverride) => syncUpdateBubbleVisibility(hiddenOverride),
  suspendUpdateBubbleForPet: () => _updateBubble.suspendForPetHidden(),
  suspendUpdateBubbleForFullscreen: () => _updateBubble.suspendForFullscreen(),
  resumeUpdateBubbleFromFullscreen: () => _updateBubble.resumeFromFullscreen(),
  keepOutOfTaskbar,
  showPermissionSurfacesForPet: () => _perm.showPermissionSurfacesForPet(),
  hidePermissionSurfacesForPet: () => _perm.hidePermissionSurfacesForPet(),
  setPermissionSurfacesFullscreenSuppressed: (suppressed) => (
    _perm.setPermissionSurfacesFullscreenSuppressed(suppressed)
  ),
});

function repositionFloatingBubbles() {
  return floatingWindowRuntime.repositionFloatingBubbles();
}

function repositionAnchoredFloatingSurfaces() {
  const result = floatingWindowRuntime.repositionAnchoredSurfaces();
  // #640: pet bounds changed — re-evaluate the editing-overlap dodge (a drag
  // can slide the pet over the bubble being typed into; the bubble itself is
  // frozen while editing, and roam is paused, so the pet is the mover here).
  topmostRuntime.syncImeEditingPetDodge();
  return result;
}

function syncSessionHudVisibilityAndBubbles() {
  return floatingWindowRuntime.syncSessionHudVisibilityAndBubbles();
}

// ── State machine — delegated to src/state/state.js ──
let showDashboard = () => {};
let broadcastDashboardSessionSnapshot = () => {};
let sendDashboardI18n = () => {};

// Forward hook for the #329 updater scheduler. State/mini ctxs reference
// this via notifyUpdaterSilentExit; the actual implementation is wired
// after the updater module is constructed below.
let notifyUpdaterSilentExit = () => {};

// #509: user-selected default idle visual, resolved against the live active
// theme so reads never go stale across theme switches. Returns null when
// unset/invalid — callers keep their existing fallback. The visible repaint
// on a pref change is the refreshIdleVisual router hook's job, further down.
const { resolveIdleVisualChoice } = require("./shell/idle-visual");
function getIdleVisualChoice() {
  return resolveIdleVisualChoice(getActiveTheme(), _settingsController.get("idleVisual"));
}

// Renderer theme config with pre-IPC choices stamped on — the first media load
// should already use the selected idle visual and tint instead of briefly
// showing theme defaults. getRendererConfig() returns a fresh object, safe to
// extend.
function buildRendererThemeConfig(accessorySnapshot = null) {
  const cfg = themeRuntime.getRendererConfig();
  if (cfg) {
    const activeTheme = getActiveTheme();
    const tintSelections = _settingsController.get("petTint");
    const tintId = getPetTintIdForTheme(tintSelections, activeTheme && activeTheme._id);
    const canonical = accessorySnapshot || getPetAccessorySlotsSnapshot(activeTheme);
    cfg.idleDefaultVisual = getIdleVisualChoice();
    cfg.petTintPayload = resolvePetTintPayload(tintId, activeTheme);
    cfg.duckAppearance = _settingsController.getSnapshot().duckAppearance;
    cfg.petRobot = _settingsController.get("petRobot");
    cfg.duckMuted = _settingsController.getSnapshot().duckMuted === true;
    cfg.duckVoiceVolume = _settingsController.getSnapshot().duckVoiceVolume;
    cfg.duckStepVolume = _settingsController.getSnapshot().duckStepVolume;
    cfg.duckStilts = _settingsController.getSnapshot().duckStilts;
    cfg.duckLocomotion = _settingsController.getSnapshot().duckLocomotion;
    if (canonical) {
      cfg.accessorySlots = {
        themeId: canonical.themeId,
        accessoryGeneration: canonical.accessoryGeneration,
        head: {
          supported: cfg.accessorySupported === true,
          attachments: cfg.accessoryAttachments || null,
          payload: canonical.payloads.head,
        },
        mouth: {
          supported: cfg.mouthAccessorySupported === true,
          attachments: cfg.mouthAccessoryAttachments || null,
          payload: canonical.payloads.mouth,
        },
      };
    }
  }
  return cfg;
}

function deliverRendererThemeConfig() {
  const delivery = prepareCurrentAccessorySlotsDelivery();
  const delivered = sendToRenderer(
    "theme-config",
    buildRendererThemeConfig(delivery.snapshot)
  );
  return !!finalizePetAccessorySlotsDelivery(delivery, delivered);
}

// The semantic state machine is created before the Reachy adapter. Keep a
// nullable forward reference so state decisions never depend on renderer IPC
// or on adapter construction order.
let _reachyMini = null;
const _stateCtx = {
  get theme() { return getActiveTheme(); },
  get win() { return win; },
  get hitWin() { return hitWin; },
  get claudeQuotaCollectionEnabled() { return claudeQuotaCollectionEnabled; },
  get doNotDisturb() { return doNotDisturb; },
  set doNotDisturb(v) { doNotDisturb = v; },
  get miniMode() { return _mini.getMiniMode(); },
  get miniTransitioning() { return _mini.getMiniTransitioning(); },
  get mouseOverPet() { return mouseOverPet; },
  get miniSleepPeeked() { return _mini.getMiniSleepPeeked(); },
  set miniSleepPeeked(v) { _mini.setMiniSleepPeeked(v); },
  get miniPeeked() { return _mini.getMiniPeeked(); },
  set miniPeeked(v) { _mini.setMiniPeeked(v); },
  get idlePaused() { return idlePaused; },
  set idlePaused(v) { idlePaused = v; },
  get forceEyeResend() { return forceEyeResend; },
  set forceEyeResend(v) { setForceEyeResend(v); },
  get mouseStillSince() { return _tick ? _tick._mouseStillSince : Date.now(); },
  get pendingPermissions() { return pendingPermissions; },
  notifyUpdaterSilentExit: () => notifyUpdaterSilentExit(),
  sendToRenderer,
  sendToHitWin,
  syncHitWin,
  playSound,
  onSemanticState: (state, options) => _reachyMini?.handleSemanticState(state, options),
  flashTaskbar,
  t: (key) => t(key),
  focusTerminalWindow: (...args) => focusTerminalWindow(...args),
  resolvePermissionEntry: (...args) => resolvePermissionEntry(...args),
  dismissPermissionsForDnd: (...args) => _perm.dismissPermissionsForDnd(...args),
  isAgentPermissionsEnabled: (agentId) =>
    _runtimeAgentGate.isAgentPermissionsEnabled(agentId),
  // state.js gates self-issued Notification events (idle / wait-for-input
  // pings) via this reader. Living in updateSession (not at the HTTP
  // boundary) keeps the gate consistent for hook / log-poll / plugin paths.
  isAgentNotificationHookEnabled: (agentId) =>
    _runtimeAgentGate.isAgentNotificationHookEnabled(agentId),
  resolveAgentDisplayName: _resolveAgentDisplayName,
  miniPeekIn: () => miniPeekIn(),
  miniPeekOut: () => miniPeekOut(),
  buildContextMenu: () => buildContextMenu(),
  buildTrayMenu: () => buildTrayMenu(),
  debugLog: (msg) => sessionLog(msg),
  broadcastSessionSnapshot: (snapshot) => {
    reconcilePowerSaveBlocker();
    broadcastDashboardSessionSnapshot(snapshot);
    broadcastSessionHudSnapshot(snapshot);
    repositionFloatingBubbles();
  },
  // Phase 3b: 读 prefs.themeOverrides 判断某个 oneshot state 是否被用户禁用。
  // state.js gate 调这个做 early-return。不做白名单校验——settings-actions
  // 负责写入合法性，这里只读。
  isOneshotDisabled: (stateKey) => {
    const theme = getActiveTheme();
    const themeId = theme && theme._id;
    if (!themeId || !stateKey) return false;
    const overrides = _settingsController.get("themeOverrides");
    const themeMap = overrides && overrides[themeId];
    const stateMap = themeMap && themeMap.states;
    const entry = (stateMap && stateMap[stateKey]) || (themeMap && themeMap[stateKey]);
    return !!(entry && entry.disabled === true);
  },
  get sessionHudCleanupDetached() { return sessionHudCleanupDetached; },
  getStaleConfig: () => ({
    sessionStaleMs,
    workingStaleMs,
    codexWorkingStaleMs,
    detachedIdleStaleMs,
  }),
  getSessionAliases: () => _settingsController.get("sessionAliases"),
  getSessionAutomationRecords: () =>
    sessionAutomationStore ? sessionAutomationStore.list() : [],
  getPermissionAutomationMode: () =>
    _settingsController.get("permissionAutomationMode") || "off",
  onSessionAutomationLifecycleEnd: (payload) => {
    if (sessionAutomationCoordinator) sessionAutomationCoordinator.onSessionLifecycleEnd(payload);
  },
  getIdleVisualChoice,
  isAgentEnabled: (agentId) => _runtimeAgentGate.isAgentEnabled(agentId),
  hasAnyEnabledAgent: () => _runtimeAgentGate.hasAnyEnabledAgent(),
};
const _state = require("./state/state")(_stateCtx);
displayedVisualProjection = createDisplayedVisualProjection({
  projectActualFile: ({ actualFile, requested }) => {
    const activeTheme = getActiveTheme();
    if (!activeTheme || !collectRequiredAssetFiles(activeTheme).includes(actualFile)) return null;
    return {
      displayState: requested.displayState,
      hitBox: _state.resolveHitBoxForSvg(actualFile),
    };
  },
  onCommit: (visual) => {
    syncDisplayedVisualGeometry();
    try { repositionAnchoredFloatingSurfaces(); } catch {}
  },
  onRendererUnresponsive: () => {
    if (!win || win.isDestroyed()) return;
    resetDisplayedVisualProjection("renderer-unresponsive", { preserveCommitted: true });
    petWindowRuntime.reloadWindowWebContents(win);
  },
});
const { setState, applyState, updateSession, resolveDisplayState, getSvgOverride,
        enableDoNotDisturb, disableDoNotDisturb, startStaleCleanup, stopStaleCleanup,
        startWakePoll, stopWakePoll, detectRunningAgentProcesses,
        startStartupRecovery: _startStartupRecovery } = _state;
const sessions = _state.sessions;

async function showSessionAutomationWarning(entry) {
  const parent = selectSessionAutomationDialogParent({
    entry,
    petWindow: win,
  });
  return permissionAutomationConfirmationRuntime.confirmPermissionAutomation({
    parent,
    lang: _settingsController.get("lang") || lang || "en",
    title: translate("sessionAutomationConfirmTitle"),
    message: translate("sessionAutomationConfirmMessage"),
    detail: translate("sessionAutomationConfirmDetail"),
    checkboxLabel: translate("permissionAutomationAutoToolsDontShowAgain"),
    confirmLabel: translate("sessionAutomationConfirmEnable"),
    cancelLabel: translate("permissionAutomationCancel"),
  });
}

sessionAutomationStore = createSessionAutomationStore({
  onChange: (changes) => {
    try { _state.emitSessionSnapshot({ force: true }); } catch {}
  },
});
sessionAutomationCoordinator = createSessionAutomationCoordinator({
  store: sessionAutomationStore,
  getSession: (sessionId) => sessions.get(sessionId) || null,
  listPending: () => pendingPermissions,
  getGlobalMode: () => _settingsController.get("permissionAutomationMode") || "off",
  canAutoResolvePendingPermission,
  resolvePermissionEntry,
  beginConfirmation: beginSessionTrustConfirmation,
  endConfirmation: endSessionTrustConfirmation,
  restoreBubble: syncPermissionBubbleContent,
  isWarningDismissed: () =>
    _settingsController.get("permissionAutomationAutoToolsWarningDismissed") === true,
  showWarning: showSessionAutomationWarning,
  rememberWarning: () =>
    _settingsController.applyUpdate("permissionAutomationAutoToolsWarningDismissed", true),
  translate: (key, fallback) => translate(key) || fallback,
});

// ── Keep-awake: block OS sleep while any agent task is in progress ──
// State→in-progress mapping lives in state-session-snapshot.isSessionInProgress
// (kept as a pure helper so the semantics are unit-tested).
let powerSaveBlockerId = null;
function anySessionInProgress() {
  for (const [, s] of sessions) {
    if (isSessionInProgress(s)) return true;
  }
  return false;
}
function reconcilePowerSaveBlocker() {
  try {
    const shouldBlock = keepAwakeWhileWorking && anySessionInProgress();
    const active = powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId);
    if (shouldBlock && !active) {
      powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!shouldBlock && active) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
    }
  } catch (err) {
    console.warn("Duck: reconcilePowerSaveBlocker failed:", err);
  }
}
function releasePowerSaveBlocker() {
  try {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
  } catch {}
  powerSaveBlockerId = null;
}

// ── Hit-test: SVG bounding box → screen coordinates ──
function getHitRectScreen(bounds) { return petWindowRuntime.getHitRectScreen(bounds); }
function getUpdateBubbleAnchorRect(bounds) { return petWindowRuntime.getUpdateBubbleAnchorRect(bounds); }
function getSessionHudAnchorRect(bounds) { return petWindowRuntime.getSessionHudAnchorRect(bounds); }

// ── Main tick — delegated to src/shell/tick.js ──
const _tickCtx = {
  get theme() { return getActiveTheme(); },
  get win() { return win; },
  getPetWindowBounds,
  get currentState() { return _state.getCurrentState(); },
  get currentSvg() { return _state.getCurrentSvg(); },
  get miniMode() { return _mini.getMiniMode(); },
  get miniTransitioning() { return _mini.getMiniTransitioning(); },
  get dragLocked() { return petWindowRuntime.isDragLocked(); },
  get menuOpen() { return menuOpen; },
  get idlePaused() { return idlePaused; },
  get lowPowerIdleMode() { return lowPowerIdleMode; },
  get lowPowerIdlePaused() { return lowPowerIdlePaused; },
  get isAnimating() { return _mini.getIsAnimating(); },
  get miniSleepPeeked() { return _mini.getMiniSleepPeeked(); },
  set miniSleepPeeked(v) { _mini.setMiniSleepPeeked(v); },
  get miniPeeked() { return _mini.getMiniPeeked(); },
  set miniPeeked(v) { _mini.setMiniPeeked(v); },
  get mouseOverPet() { return mouseOverPet; },
  set mouseOverPet(v) { mouseOverPet = v; },
  get forceEyeResend() { return forceEyeResend; },
  set forceEyeResend(v) { setForceEyeResend(v); },
  get forceEyeResendBoostUntil() { return forceEyeResendBoostUntil; },
  get startupRecoveryActive() { return _state.getStartupRecoveryActive(); },
  sendToRenderer,
  sendToHitWin,
  isVisualGenerationCurrent,
  setState,
  applyState,
  getIdleVisualChoice,
  getEffectiveAccessoryIds: getEffectivePetAccessoryIds,
  miniPeekIn: () => miniPeekIn(),
  miniPeekOut: () => miniPeekOut(),
  getObjRect,
  getHitRectScreen,
  getAssetPointerPayload,
  get roam() { return _roam; },
};
const _tick = require("./shell/tick")(_tickCtx);
requestFastTick = (maxDelay) => _tick.scheduleSoon(maxDelay);
const { startMainTick, resetIdleTimer } = _tick;

// ── Terminal focus — delegated to src/shell/focus.js ──
const _focus = require("./shell/focus")({ _allowSetForeground, focusLog });
const {
  initFocusHelper,
  killFocusHelper,
  focusTerminalWindow,
  captureGhosttyTerminalId,
  clearMacFocusCooldownTimer,
} = _focus;

function getFocusableLocalHudSessionIds() {
  if (!_state || typeof _state.buildSessionSnapshot !== "function") return [];
  return selectFocusableLocalHudSessionIds(_state.buildSessionSnapshot(), { osPlatform: process.platform });
}

function focusTerminalSession(session, sessionId, requestSource) {
  if (!session || (!session.sourcePid && !session.orcaPaneKey)) return false;
  return focusTerminalWindow({
    sourcePid: session.sourcePid,
    wtHwnd: session.wtHwnd,
    cwd: session.cwd,
    editor: session.editor,
    pidChain: session.pidChain,
    tmuxSocket: session.tmuxSocket,
    tmuxClient: session.tmuxClient,
    orcaPaneKey: session.orcaPaneKey,
    ghosttyTerminalId: session.ghosttyTerminalId,
    sessionId: String(sessionId),
    agentId: session.agentId,
    requestSource,
  });
}

function focusDashboardSession(sessionId, options = {}) {
  if (!sessionId) return false;
  const requestSource = options.requestSource || "dashboard";
  const id = String(sessionId);
  const session = sessions.get(id);
  const fallbackEntry = options.fallbackEntry && typeof options.fallbackEntry === "object"
    ? options.fallbackEntry
    : null;
  if (!session && !fallbackEntry) {
    focusLog(`focus result branch=none reason=session-not-found source=${requestSource} sid=${id}`);
    return false;
  }

  const focusEntry = { ...(session || {}), ...(fallbackEntry || {}), id };
  const focusTarget = getSessionFocusTarget(focusEntry, { osPlatform: process.platform });
  if (focusTarget.type === "codex-thread" && focusTarget.url) {
    focusCodexThreadTarget({
      shell,
      focusEntry,
      sessionId: id,
      requestSource,
      url: focusTarget.url,
      focusLog,
      focusTerminalSession,
    });
    return true;
  }

  if (focusTarget.type === "terminal") {
    return focusTerminalSession(focusEntry, id, requestSource);
  }

  if (focusEntry.platform === "webui") {
    focusLog(`focus result branch=none reason=webui-unfocusable source=${requestSource} sid=${id}`);
  } else {
    focusLog(`focus result branch=none reason=no-source-pid source=${requestSource} sid=${id}`);
  }
  return false;
}

function hideDashboardSession(sessionId) {
  if (!_state || typeof _state.dismissSession !== "function") {
    return { status: "error", message: "session state is not ready" };
  }
  const removed = _state.dismissSession(String(sessionId || ""));
  return removed
    ? { status: "ok" }
    : { status: "not-found" };
}

const openDashboardSessionFolder = createSessionFolderOpener({
  getSession: (sessionId) => sessions.get(sessionId),
  openPath: (cwd) => shell.openPath(cwd),
});

const _dashboard = require("./shell/dashboard")({
  get lang() { return lang; },
  t: (key) => translate(key),
  getSessionSnapshot: () => _state.buildSessionSnapshot(),
  getI18n: () => getDashboardI18nPayload(),
  getPetWindowBounds,
  getNearestWorkArea,
  getSettingsWindow: () => settingsWindowRuntime.getWindow(),
  getTextScale: (bounds) => effectiveTextScaleForKey(
    getDisplayKeyForBounds(bounds)
    || getWindowDisplayKey(_dashboard ? _dashboard.getWindow() : null)
    || getPetDisplayKey()
  ),
  getSavedBounds: () => _settingsController.get("dashboardWindowBounds"),
  onSaveBounds: (bounds) => _settingsController.applyUpdate("dashboardWindowBounds", bounds),
  iconPath: settingsWindowRuntime.getIconPath(),
});
showDashboard = _dashboard.showDashboard;
broadcastDashboardSessionSnapshot = _dashboard.broadcastSessionSnapshot;
sendDashboardI18n = _dashboard.sendI18n;

const _sessionHud = require("./state/session-hud")({
  get win() { return win; },
  get petHidden() { return petWindowRuntime.isPetEffectivelyHidden(); },
  get sessionHudEnabled() { return sessionHudEnabled; },
  get sessionHudShowStateLabels() { return sessionHudShowStateLabels; },
  get sessionHudShowElapsed() { return sessionHudShowElapsed; },
  get sessionHudShowContextUsage() { return sessionHudShowContextUsage; },
  get sessionHudPinned() { return sessionHudPinned; },
  get lowPowerIdleMode() { return lowPowerIdleMode; },
  getMiniMode: () => _mini.getMiniMode(),
  getMiniTransitioning: () => _mini.getMiniTransitioning(),
  getSessionSnapshot: () => _state.buildSessionSnapshot(),
  getI18n: () => getDashboardI18nPayload(),
  getPetWindowBounds,
  getHitRectScreen,
  getSessionHudAnchorRect,
  getNearestWorkArea,
  getTextScale: () => getTextScaleForPetWindows(),
  getPermissionBubbleBounds: () => _perm.getVisibleBubbleBounds(),
  getUpdateBubbleWindow: () => _updateBubble.getBubbleWindow(),
  guardAlwaysOnTop,
  reapplyMacVisibility,
  onReservedOffsetChange: () => repositionFloatingBubbles(),
});
repositionSessionHud = _sessionHud.repositionSessionHud;
syncSessionHudVisibility = _sessionHud.syncSessionHud;
broadcastSessionHudSnapshot = _sessionHud.broadcastSessionSnapshot;
sendSessionHudI18n = _sessionHud.sendI18n;
getSessionHudReservedOffset = _sessionHud.getHudReservedOffset;
getSessionHudWindow = _sessionHud.getWindow;

agentRuntime = createAgentRuntimeMain({
  getServer: () => _server,
  getStateRuntime: () => _state,
  getPermissionRuntime: () => _perm,
  isAgentEnabled: (agentId) => _runtimeAgentGate.isAgentEnabled(agentId),
  updateSession: (sessionId, state, event, opts) => updateSession(sessionId, state, event, opts),
  debugLog: (msg) => sessionLog(msg),
  captureGhosttyTerminalId,
  clearCodexNotifyBubbles: (...args) => clearCodexNotifyBubbles(...args),
  showCodexUserInputBubble: (...args) => showCodexUserInputBubble(...args),
  clearCodexUserInputBubbles: (...args) => clearCodexUserInputBubbles(...args),
});

// ── HTTP server — delegated to src/state/server.js ──
const _serverCtx = {
  get manageClaudeHooksAutomatically() { return manageClaudeHooksAutomatically; },
  get autoStartWithClaude() { return autoStartWithClaude; },
  get claudeQuotaCollectionEnabled() { return claudeQuotaCollectionEnabled; },
  get doNotDisturb() { return doNotDisturb; },
  shouldDropForDnd: () => _state.shouldDropForDnd ? _state.shouldDropForDnd() : doNotDisturb,
  get hideBubbles() { return getAllBubblesHidden(); },
  getBubblePolicy: getRuntimeBubblePolicy,
  get pendingPermissions() { return pendingPermissions; },
  get PASSTHROUGH_TOOLS() { return PASSTHROUGH_TOOLS; },
  get STATE_SVGS() { return _state.STATE_SVGS; },
  get sessions() { return sessions; },
  getCustomAgentIds: () => (_settingsController.get("customApplications") || [])
    .map((application) => application && application.id)
    .filter(Boolean),
  onHookEventRecorded: (event) => {
    if (!event || event.route !== "state" || event.outcome !== "accepted") return;
    const registered = (_settingsController.get("customApplications") || [])
      .some((application) => application && application.id === event.agentId);
    if (!registered) return;
    broadcastSettingsWindow("settings:agent-activity", {
      agentId: event.agentId,
      timestamp: event.timestamp,
      eventType: event.eventType,
    });
  },
  // #627 residual: synchronous server-side wt_hwnd sample for UserPromptSubmit
  // (src/state/server-route-state.js). Initialized once above; never re-created per
  // request.
  captureForegroundWindowsTerminal: _captureForegroundWindowsTerminal,
  debugLog: (msg) => sessionLog(msg),
  recordWindowsProcessChainShadow: (record) => recordWindowsProcessChainShadow(record),
  isAgentEnabled: (agentId) => _runtimeAgentGate.isAgentEnabled(agentId),
  shouldSyncAgentIntegration: (agentId) =>
    _runtimeAgentGate.shouldSyncAgentIntegration(agentId),
  getAgentIntegrationOptions: _getAgentIntegrationOptions,
  isAgentPermissionsEnabled: (agentId) => _runtimeAgentGate.isAgentPermissionsEnabled(agentId),
  isAgentSubagentPermissionsEnabled: (agentId) => _runtimeAgentGate.isAgentSubagentPermissionsEnabled(agentId),
  isCodexNativeNotificationSoundEnabled: () => _runtimeAgentGate.isCodexNativeNotificationSoundEnabled(),
  isCodexPermissionInterceptEnabled: () => _runtimeAgentGate.isCodexPermissionInterceptEnabled(),
  codexSubagentClassifier: agentRuntime.getCodexSubagentClassifier(),
  setState,
  updateSession: agentRuntime.updateSessionFromServer,
  updateSessionMetadata: (sessionId, opts) => _state.updateSessionMetadata(sessionId, opts),
  clearClaudeStatuslineAuthority: (profileId) => _state.clearClaudeStatuslineAuthority(profileId),
  resolvePermissionEntry,
  sendPermissionResponse,
  addPendingPermission,
  removePendingPermission,
  isPermissionEntryLive,
  canAutoResolvePendingPermission,
  maybeAutoResolveSessionPermission: (entry, options) =>
    !!(sessionAutomationCoordinator
      && sessionAutomationCoordinator.resolveIfAllowed(entry, options)),
  showPermissionBubble,
  showCodexUserInputBubble,
  clearCodexUserInputBubbles,
  handleTestResult: (result, context) => handleTestResult(result, context),
  maybeStartRemoteApproval,
  replyOpencodeFamilyPermission,
  dismissOpencodeFamilyPermissionResolvedExternally,
  syncPermissionShortcuts,
  permLog,
};
const _server = require("./state/server")(_serverCtx);
const { startHttpServer, getHookServerPort } = _server;

function updateLog(msg) {
  if (!updateDebugLog) return;
  const { rotatedAppend } = require("./shell/log-rotate");
  rotatedAppend(updateDebugLog, `[${new Date().toISOString()}] ${msg}\n`);
}

function sessionLog(msg) {
  if (!sessionDebugLog) return;
  const { rotatedAppend } = require("./shell/log-rotate");
  rotatedAppend(sessionDebugLog, `[${formatLocalTimestamp()}] ${msg}\n`);
}

ipcMain.on("sound-playback-error", (_event, payload) => {
  const phase = payload && typeof payload.phase === "string"
    ? payload.phase.replace(/[^a-z0-9_-]/gi, "").slice(0, 32)
    : "unknown";
  const message = payload && typeof payload.message === "string"
    ? payload.message.replace(/\s+/g, " ").slice(0, 240)
    : "unknown";
  sessionLog(`sound playback error phase=${phase || "unknown"} message=${message || "unknown"}`);
});

function focusLog(msg) {
  if (!focusDebugLog) return;
  const { rotatedAppend } = require("./shell/log-rotate");
  rotatedAppend(focusDebugLog, `[${new Date().toISOString()}] ${msg}\n`);
}

// ── Menu — delegated to src/shell/menu.js ──
//
// Setters that previously assigned to module-level vars now route through
// `_settingsController.applyUpdate(key, value)`. The mirror cache is updated
// by the settings-effect-router subscriber after this ctx is built. Side
// effects that used to live inside setters (e.g.
// `syncPermissionShortcuts()` for hideBubbles) are now reactive and live in
// the subscriber too.

async function confirmDangerousMode(t) {
  const parent = win && !win.isDestroyed() ? win : null;
  const result = await electronDialog.showMessageBox(parent, {
    type: "warning",
    buttons: [t("confirm") || "Confirm", t("cancel") || "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: t("dangerousConfirmTitle") || "Confirm Dangerous Mode",
    message: t("dangerousConfirmMessage") || "Dangerous mode skips ALL permission checks.",
  });
  return result.response === 0;
}

// Await launchClaudeSession and surface failures instead of swallowing them:
// show a localized error dialog so the user knows nothing happened, and log
// for diagnosis. Never throws.
async function runLaunchClaudeSession(t, mode, cwd, sessionId) {
  let res;
  try {
    res = await launchClaudeSession(mode, cwd, sessionId);
  } catch (err) {
    console.error("[launch-claude] launch threw:", err);
    res = { ok: false, message: (err && err.message) || String(err) };
  }
  if (res && res.ok) return res;
  console.error("[launch-claude] launch failed:", res && res.message);
  try {
    const parent = win && !win.isDestroyed() ? win : null;
    await electronDialog.showMessageBox(parent, {
      type: "error",
      buttons: [t("dismiss") || "OK"],
      title: t("newSession") || "New Session",
      message: t("launchFailed") || "Failed to launch Claude Code.",
      detail: (res && res.message) || "",
    });
  } catch (err) {
    console.error("[launch-claude] failed to show error dialog:", err);
  }
  return res;
}

function showResumeInput(t) {
  return new Promise((resolve) => {
    // data: URL — outside the file:// zoom map, so the scale is baked into the
    // window size and an inline body zoom instead.
    const resumeScale = getTextScaleForPetWindows();
    const inputWin = new BrowserWindow({
      width: scaleWidth(420, resumeScale),
      height: scaleHeight(180, resumeScale),
      resizable: false,
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      parent: win && !win.isDestroyed() ? win : undefined,
      modal: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    const title = t("resumeSessionTitle") || "Resume Session";
    const hint = t("resumeSessionHint") || "Enter Session ID";
    const confirmLabel = t("confirm") || "OK";
    const cancelLabel = t("dismiss") || "Cancel";
    const html = `<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{zoom:${resumeScale};font-family:system-ui,-apple-system,sans-serif;background:#1e1e2e;color:#cdd6f4;display:flex;flex-direction:column;height:calc(100vh / ${resumeScale});padding:16px;border-radius:12px;overflow:hidden}
      .title{font-size:14px;font-weight:600;margin-bottom:12px}
      input{width:100%;padding:8px 12px;border:1px solid #45475a;border-radius:6px;background:#313244;color:#cdd6f4;font-size:13px;outline:none}
      input:focus{border-color:#89b4fa}
      input::placeholder{color:#6c7086}
      .btns{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}
      button{padding:6px 16px;border:none;border-radius:6px;font-size:12px;cursor:pointer}
      .ok{background:#89b4fa;color:#1e1e2e;font-weight:600}
      .cancel{background:#45475a;color:#cdd6f4}
    </style></head><body>
      <div class="title">${title}</div>
      <input id="sid" type="text" placeholder="${hint}" autofocus />
      <div class="btns">
        <button class="cancel" onclick="result(null)">${cancelLabel}</button>
        <button class="ok" onclick="result(document.getElementById('sid').value)">${confirmLabel}</button>
      </div>
      <script>
        function result(v){window._resolve(v)}
        document.getElementById('sid').addEventListener('keydown',e=>{
          if(e.key==='Enter')result(document.getElementById('sid').value);
          if(e.key==='Escape')result(null);
        });
      </script>
    </body></html>`;
    inputWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    inputWin.webContents.on("did-finish-load", () => {
      inputWin.webContents.executeJavaScript(
        "new Promise(r=>{window._resolve=r})"
      ).then((val) => {
        const sessionId = typeof val === "string" ? val.trim() : "";
        resolve(sessionId || null);
        try { inputWin.close(); } catch {}
      });
    });
    inputWin.on("closed", () => resolve(null));
  });
}

let robotPowerControl = null;
const _menuCtx = {
  get win() { return win; },
  get sessions() { return sessions; },
  get currentSize() { return currentSize; },
  set currentSize(v) { _settingsController.applyUpdate("size", v); },
  get doNotDisturb() { return doNotDisturb; },
  get lang() { return lang; },
  set lang(v) { _settingsController.applyUpdate("lang", v); },
  get showTray() { return showTray; },
  set showTray(v) { _settingsController.applyUpdate("showTray", v); },
  get showDock() { return showDock; },
  set showDock(v) { _settingsController.applyUpdate("showDock", v); },
  get manageClaudeHooksAutomatically() { return manageClaudeHooksAutomatically; },
  get autoStartWithClaude() { return autoStartWithClaude; },
  set autoStartWithClaude(v) { _settingsController.applyUpdate("autoStartWithClaude", v); },
  get openAtLogin() { return openAtLogin; },
  set openAtLogin(v) { _settingsController.applyUpdate("openAtLogin", v); },
  get bubbleFollowPet() { return bubbleFollowPet; },
  set bubbleFollowPet(v) { _settingsController.applyUpdate("bubbleFollowPet", v); },
  get hideBubbles() { return getAllBubblesHidden(); },
  set hideBubbles(v) { _settingsController.applyCommand("setAllBubblesHidden", { hidden: !!v }).catch((err) => {
    console.warn("Duck: setAllBubblesHidden failed:", err && err.message);
  }); },
  get permissionAutomationMode() {
    return _settingsController.get("permissionAutomationMode") || "off";
  },
  isPermissionAutomationWarningDismissed(mode) {
    const key = mode === "auto-tools"
      ? "permissionAutomationAutoToolsWarningDismissed"
      : (mode === "unattended"
        ? "permissionAutomationUnattendedWarningDismissed"
        : null);
    return key ? _settingsController.get(key) === true : false;
  },
  setPermissionAutomationMode(mode, options = {}) {
    return _settingsController.applyCommand("setPermissionAutomationMode", {
      mode,
      confirmed: options.confirmed === true,
      suppressFutureConfirmation: options.suppressFutureConfirmation === true,
    }).catch((err) => {
      console.warn("Duck: setPermissionAutomationMode failed:", err && err.message);
      return { status: "error", message: err && err.message };
    });
  },
  confirmPermissionAutomation: (payload) => (
    permissionAutomationConfirmationRuntime.confirmPermissionAutomation(payload)
  ),
  showPermissionAutomationError: (payload) => (
    permissionAutomationConfirmationRuntime.showPermissionAutomationError(payload)
  ),
  get soundMuted() { return soundMuted; },
  set soundMuted(v) { _settingsController.applyUpdate("soundMuted", v); },
  get soundVolume() { return soundVolume; },
  get pendingPermissions() { return pendingPermissions; },
  repositionBubbles: () => repositionFloatingBubbles(),
  get petHidden() { return petWindowRuntime.isPetEffectivelyHidden(); },
  setPetVisibility: (visible) => setPetVisibility(visible),
  bringPetToPrimaryDisplay: () => bringPetToPrimaryDisplay(),
  get isQuitting() { return isQuitting; },
  set isQuitting(v) { isQuitting = v; },
  get menuOpen() { return menuOpen; },
  set menuOpen(v) { menuOpen = v; },
  get tray() { return tray; },
  set tray(v) { tray = v; },
  get contextMenuOwner() { return contextMenuOwner; },
  set contextMenuOwner(v) { contextMenuOwner = v; },
  get contextMenu() { return contextMenu; },
  set contextMenu(v) { contextMenu = v; },
  enableDoNotDisturb: () => enableDoNotDisturb(),
  disableDoNotDisturb: () => disableDoNotDisturb(),
  isRobotSleeping: () => doNotDisturb || ["sleeping", "dozing", "collapsing"].includes(_state.getCurrentState()) || robotPowerControl?.needsWake(),
  isRobotWaking: () => robotPowerControl?.isBusy(),
  wakeRobot: async () => {
    try { await robotPowerControl?.wake(); }
    catch (error) { await electronDialog.showMessageBox({ type: "error", message: t("robotWakeFailed"), detail: error.message }); }
    rebuildAllMenus();
  },
  enterMiniViaMenu: () => {
    if (!disableMiniModeCached) enterMiniViaMenu();
  },
  exitMiniMode: () => exitMiniMode(),
  getDisableMiniMode: () => disableMiniModeCached,
  getMiniMode: () => _mini.getMiniMode(),
  getMiniTransitioning: () => _mini.getMiniTransitioning(),
  miniHandleResize: (sizeKey) => _mini.handleResize(sizeKey),
  checkForUpdates: (...args) => checkForUpdates(...args),
  getUpdateMenuItem: () => getUpdateMenuItem(),
  openDashboard: () => showDashboard(),
  launchClaudeSession: (mode, cwd, sessionId) => launchClaudeSession(mode, cwd, sessionId),
  newSessionWithFolder: async (t) => {
    const parent = win && !win.isDestroyed() ? win : null;
    const result = await electronDialog.showOpenDialog(parent, {
      title: t("selectFolder"),
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return;
    const folder = result.filePaths[0];
    const mode = await electronDialog.showMessageBox(parent, {
      type: "question",
      buttons: [t("newSessionNormal"), t("newSessionDangerous"), t("newSessionContinue"), t("newSessionResume"), t("dismiss")],
      defaultId: 0,
      cancelId: 4,
      title: t("newSession"),
      message: t("newSession"),
      detail: folder,
    });
    if (mode.response === 4) return;
    if (mode.response === 3) {
      const sessionId = await showResumeInput(t);
      if (!sessionId) return;
      const resumeMode = await electronDialog.showMessageBox(parent, {
        type: "question",
        buttons: [t("modeNormal"), t("modeDangerous"), t("dismiss")],
        defaultId: 0,
        cancelId: 2,
        title: t("newSessionResume"),
        message: sessionId,
      });
      if (resumeMode.response === 2) return;
      if (resumeMode.response === 1 && !(await confirmDangerousMode(t))) return;
      await runLaunchClaudeSession(t, resumeMode.response === 1 ? "resume-dangerous" : "resume", folder, sessionId);
      return;
    }
    if (mode.response === 1 && !(await confirmDangerousMode(t))) return;
    const modes = ["normal", "dangerous", "continue"];
    await runLaunchClaudeSession(t, modes[mode.response], folder);
  },
  newSessionInCurrentDir: async (t) => {
    const parent = win && !win.isDestroyed() ? win : null;
    const mode = await electronDialog.showMessageBox(parent, {
      type: "question",
      buttons: [t("newSessionNormal"), t("newSessionDangerous"), t("newSessionContinue"), t("newSessionResume"), t("dismiss")],
      defaultId: 0,
      cancelId: 4,
      title: t("newSession"),
      message: t("newSession"),
    });
    if (mode.response === 4) return;
    if (mode.response === 3) {
      const sessionId = await showResumeInput(t);
      if (!sessionId) return;
      const resumeMode = await electronDialog.showMessageBox(parent, {
        type: "question",
        buttons: [t("modeNormal"), t("modeDangerous"), t("dismiss")],
        defaultId: 0,
        cancelId: 2,
        title: t("newSessionResume"),
        message: sessionId,
      });
      if (resumeMode.response === 2) return;
      if (resumeMode.response === 1 && !(await confirmDangerousMode(t))) return;
      await runLaunchClaudeSession(t, resumeMode.response === 1 ? "resume-dangerous" : "resume", undefined, sessionId);
      return;
    }
    if (mode.response === 1 && !(await confirmDangerousMode(t))) return;
    const modes = ["normal", "dangerous", "continue"];
    await runLaunchClaudeSession(t, modes[mode.response]);
  },
  // The settings controller is the only writer of persisted prefs. Toggle
  // setters above route through it; resize/sendToDisplay use
  // flushRuntimeStateToPrefs to capture window bounds after movement.
  flushRuntimeStateToPrefs,
  getDuckActionStatus: () => duckActionStatus,
  getDuckActions: () => duckActionCatalog(),
  playDuckAction: id => {
    if (_settingsController.get('petRobot') !== 'duck') return;
    if (id === 'peck' || duckActionCatalog().some(action => action.id === id)) sendToRenderer('duck-play-action', id);
  },
  openActionLab: () => { robotLabRuntime.open({lesson:'actions'}); _settingsController.applyUpdate('developerMode', true); },
  settings: _settingsController,
  syncHitWin,
  getPetWindowBounds,
  applyPetWindowBounds,
  getCurrentPixelSize,
  getEffectiveCurrentPixelSize,
  getPixelSizeFor,
  isProportionalMode,
  PROPORTIONAL_RATIOS,
  getHookServerPort: () => getHookServerPort(),
  clampToScreenVisual,
  getNearestWorkArea,
  reapplyMacVisibility,
  getSettingsWindow,
  getRobotLabWindow: () => robotLabRuntime.getWindow(),
  getSystemVersion: () => process.getSystemVersion(),
  discoverThemes: () => themeLoader.discoverThemes(),
  getActiveThemeId: () => themeRuntime.getActiveThemeId("duck"),
  getActiveThemeCapabilities: () => themeRuntime.getActiveThemeCapabilities(),
  ensureUserThemesDir: () => themeLoader.ensureUserThemesDir(),
  openSettingsWindow: (options) => settingsWindowRuntime.open(options),
};
const _menu = require("./shell/menu")(_menuCtx);
const { t, buildContextMenu, buildTrayMenu, rebuildAllMenus, createTray,
        destroyTray, showPetContextMenu, ensureContextMenuOwner,
        requestAppQuit, applyDockVisibility } = _menu;

// ── Settings effect router ──
const SETTINGS_MIRROR_SETTERS = {
  lang: (v) => { lang = v; }, size: (v) => { currentSize = v; resetKeepSizeFrozen(); }, showTray: (v) => { showTray = v; },
  showDock: (v) => { showDock = v; if (macHideController) macHideController.noteManualChange(); }, manageClaudeHooksAutomatically: (v) => { manageClaudeHooksAutomatically = v; },
  autoStartWithClaude: (v) => { autoStartWithClaude = v; }, openAtLogin: (v) => { openAtLogin = v; },
  bubbleFollowPet: (v) => { bubbleFollowPet = v; },
  bubbleFollowPreference: (v) => { bubbleFollowPreference = v; },
  bubbleFixedCorner: (v) => { bubbleFixedCorner = v; },
  sessionHudEnabled: (v) => { sessionHudEnabled = v; },
  sessionHudShowStateLabels: (v) => { sessionHudShowStateLabels = v; },
  sessionHudShowElapsed: (v) => { sessionHudShowElapsed = v; },
  sessionHudShowContextUsage: (v) => { sessionHudShowContextUsage = v; },
  claudeQuotaCollectionEnabled: (v) => { claudeQuotaCollectionEnabled = v; },
  sessionHudCleanupDetached: (v) => { sessionHudCleanupDetached = v; },
  sessionHudPinned: (v) => { sessionHudPinned = v; },
  sessionStaleMs: (v) => { sessionStaleMs = v; }, workingStaleMs: (v) => { workingStaleMs = v; },
  codexWorkingStaleMs: (v) => { codexWorkingStaleMs = v; },
  detachedIdleStaleMs: (v) => { detachedIdleStaleMs = v; },
  soundMuted: (v) => { soundMuted = v; }, soundVolume: (v) => { soundVolume = v; }, lowPowerIdleMode: (v) => { lowPowerIdleMode = v; },
  keepAwakeWhileWorking: (v) => { keepAwakeWhileWorking = v; },
  petTint: (v) => { petTint = v; },
  allowEdgePinning: (v) => { allowEdgePinningCached = v; }, disableMiniMode: (v) => { disableMiniModeCached = v; }, keepSizeAcrossDisplays: (v) => { keepSizeAcrossDisplaysCached = v; resetKeepSizeFrozen(); },
  fullscreenOverlay: (v) => { fullscreenOverlayCached = v; },
  fullscreenAutoHide: (v) => {
    fullscreenAutoHideCached = v;
    if (!v) {
      topmostRuntime.clearFullscreenAutoHideOverride();
      petWindowRuntime.setFullscreenAutoHidden(false);
    }
  },
  freeRoam: (v) => { _roam.setEnabled(v); },
  textScale: (v) => { textScale = v; textScalePreview = null; },
  textScaleByDisplay: (v) => { textScaleByDisplay = v; textScalePreview = null; },
};

function updateSettingsMirrors(changes) { for (const [key, value] of Object.entries(changes)) if (SETTINGS_MIRROR_SETTERS[key]) SETTINGS_MIRROR_SETTERS[key](value); }

function callRuntimeMethod(owner, method, ...args) { return owner && typeof owner[method] === "function" ? owner[method](...args) : undefined; }

function reclampPetAfterEdgePinningChange() {
  if (!win || win.isDestroyed() || petWindowRuntime.isDragLocked() || _mini.getMiniMode() || _mini.getMiniTransitioning()) return;
  const clamped = computeFinalDragBounds(getPetWindowBounds(), getEffectiveCurrentPixelSize(), clampToScreenVisual);
  if (clamped) applyPetWindowBounds(clamped);
  syncHitWin(); repositionFloatingBubbles();
}

const holidayAccessoryRuntime = createHolidayAccessoryRuntime({
  powerMonitor,
  getSettingsSnapshot: () => _settingsController.getSnapshot(),
  getActiveTheme: () => getActiveTheme(),
  sendToRenderer,
  onAccessoryChange: syncHitWin,
  logWarn: console.warn,
});

const settingsEffectRouter = createSettingsEffectRouter({
  settingsController: _settingsController,
  BrowserWindow,
  updateMirrors: updateSettingsMirrors,
  createTray,
  destroyTray,
  applyDockVisibility,
  sendToRenderer,
  sendDashboardI18n: () => sendDashboardI18n(),
  sendSessionHudI18n: () => sendSessionHudI18n(),
  syncWindowTitles: () => {
    settingsWindowRuntime.applyTitleToWindow();
  },
  emitSessionSnapshot: (options) => _state.emitSessionSnapshot(options),
  cleanStaleSessions: () => _state.cleanStaleSessions(),
  syncPermissionShortcuts,
  dismissInteractivePermissionBubbles: () => callRuntimeMethod(_perm, "dismissInteractivePermissionBubbles"),
  clearCodexNotifyBubbles,
  clearCodexUserInputBubbles,
  refreshPassiveNotifyAutoClose: () => callRuntimeMethod(_perm, "refreshPassiveNotifyAutoClose"),
  refreshPermissionAutoCloseForPolicy: () => callRuntimeMethod(_perm, "refreshPermissionAutoCloseForPolicy"),
  hideUpdateBubbleForPolicy: () => callRuntimeMethod(_updateBubble, "hideForPolicy"),
  refreshUpdateBubbleAutoClose: () => callRuntimeMethod(_updateBubble, "refreshAutoCloseForPolicy"),
  repositionFloatingBubbles,
  applyTextScale: () => applyTextScaleNow(),
  syncSessionHudVisibility: () => syncSessionHudVisibility(),
  handleSessionHudPinnedChanged: (next) => {
    if (_sessionHud && typeof _sessionHud.handlePinnedChanged === "function") {
      _sessionHud.handlePinnedChanged(next);
    }
  },
  reclampPetAfterEdgePinningChange,
  exitMiniMode: () => exitMiniMode(),
  getMiniMode: () => _mini.getMiniMode(),
  getActiveTheme: () => getActiveTheme(),
  syncHitWin,
  // #509: re-rest the pet on the newly selected idle visual right away, but
  // only while actually idle — task/sleep/mini states pick it up on their
  // next natural revert instead.
  refreshIdleVisual: () => {
    if (_state.getCurrentState() !== "idle") return;
    _state.applyState("idle", _state.getSvgOverride("idle"));
  },
  refreshDisplayedVisual: refreshDisplayedVisualForLowPowerMode,
  rebuildAllMenus,
  reconcilePowerSaveBlocker,
  logWarn: console.warn,
});
settingsEffectRouter.start();
animationOverridesMain = createSettingsAnimationOverridesMain({
  app,
  BrowserWindow,
  dialog,
  shell,
  fs,
  path,
  themeLoader,
  settingsController: _settingsController,
  getActiveTheme: () => getActiveTheme(),
  getSettingsWindow,
  getLang: () => lang,
  getThemeReloadInProgress: () => themeRuntime.isReloadInProgress(),
  getStateRuntime: () => _state,
  sendToRenderer,
});
registerSettingsAnimationOverridesIpc({
  ipcMain,
  animationOverridesMain,
});
// ── Auto-updater — delegated to src/shell/updater.js ──
const _updaterCtx = {
  get doNotDisturb() { return doNotDisturb; },
  get miniMode() { return _mini.getMiniMode(); },
  get lang() { return lang; },
  t, rebuildAllMenus, updateLog,
  showUpdateBubble: (payload) => showUpdateBubble(payload),
  hideUpdateBubble: () => hideUpdateBubble(),
  setUpdateVisualState: (kind) => _state.setUpdateVisualState(kind),
  applyState: (state, svgOverride) => applyState(state, svgOverride),
  resolveDisplayState: () => resolveDisplayState(),
  getSvgOverride: (state) => getSvgOverride(state),
  resetSoundCooldown: () => resetSoundCooldown(),
  onUpdateCheckStatusChanged: (snapshot) => {
    broadcastSettingsWindow("settings:update-check-status", snapshot);
  },
  // #329 scheduler / pending-state prefs IO. Reads go straight to the
  // settingsController snapshot; writes go through applyUpdate so the
  // single-writer architecture (settings-controller.js) is honored.
  getUpdatePref: (key) => {
    try { return _settingsController.get(key); } catch { return undefined; }
  },
  setUpdatePref: (key, value) => {
    try { _settingsController.applyUpdate(key, value); } catch {}
  },
};
const _updater = require("./shell/updater")(_updaterCtx);
const {
  setupAutoUpdater,
  checkForUpdates,
  getUpdateCheckSnapshot,
  clearUpdateError,
  getUpdateMenuItem,
  getUpdateMenuLabel,
  reconcilePendingOnStartup,
  onSilentModeExit: updaterOnSilentModeExit,
  startUpdateScheduler,
  stopUpdateScheduler,
} = _updater;
// Now that updater is constructed, point the forward hook at it.
notifyUpdaterSilentExit = () => { try { updaterOnSilentModeExit(); } catch {} };

// #329: react to the autoUpdateCheck toggle in real time so users see
// the scheduler start/stop without restarting Duck.
try {
  _settingsController.subscribeKey("autoUpdateCheck", (value) => {
    try {
      if (value === false) stopUpdateScheduler();
      else startUpdateScheduler();
    } catch (err) {
      updateLog(`scheduler toggle failed: ${err && err.message}`);
    }
  });
} catch (err) {
  updateLog(`scheduler subscribeKey failed: ${err && err.message}`);
}

// ── Doctor tab IPC ──
const { registerDoctorIpc } = require("./shell/doctor-ipc");
registerDoctorIpc({
  ipcMain,
  app,
  shell,
  server: _server,
  getPrefsSnapshot: () => _settingsController.getSnapshot(),
  getPrefsReadFailure: () => _settingsController.hasReadFailure(),
  getPrefsRecovered: () => _initialPrefsRecovered && !_settingsController.hasReadFailure(),
  getPrefsRecoveryBackupFailed: () => _initialPrefsRecoveryBackupFailed,
  getDoNotDisturb: () => doNotDisturb,
  getLocale: () => _settingsController.get("lang") || "en",
  resolveAgentDisplayName: _resolveAgentDisplayName,
});

// ── Settings panel window ──
//
// Single-instance, non-modal, system-titlebar BrowserWindow that hosts the
// settings UI. Reuses the settings IPC registration already wired up for the
// controller. The renderer subscribes to
// settings-changed broadcasts so menu changes and panel changes stay in sync.
const SIZE_PREVIEW_KEY_RE = /^P:\d+(?:\.\d+)?$/;

function isValidSizePreviewKey(value) {
  return typeof value === "string" && SIZE_PREVIEW_KEY_RE.test(value);
}

function beginSettingsSizePreviewProtection() {
  return petWindowRuntime.beginSettingsSizePreviewProtection();
}

function endSettingsSizePreviewProtection() {
  return petWindowRuntime.endSettingsSizePreviewProtection();
}

const settingsSizePreviewSession = createSettingsSizePreviewSession({
  beginProtection: async () => {
    beginSettingsSizePreviewProtection();
  },
  endProtection: async () => {
    endSettingsSizePreviewProtection();
  },
  applyPreview: async (sizeKey) => {
    if (!isValidSizePreviewKey(sizeKey)) {
      throw new Error(`invalid preview size "${sizeKey}"`);
    }
    if (_menu && typeof _menu.resizeWindow === "function") {
      _menu.resizeWindow(sizeKey, { mode: "preview" });
    }
  },
  commitFinal: async (sizeKey) => {
    if (!isValidSizePreviewKey(sizeKey)) {
      return { status: "error", message: `invalid preview size "${sizeKey}"` };
    }
    return _settingsController.applyCommand("resizePet", sizeKey);
  },
});

const settingsIpcRuntime = registerSettingsIpc({
  ipcMain,
  app,
  BrowserWindow,
  dialog,
  shell,
  fs,
  path,
  settingsController: _settingsController,
  themeLoader,
  codexPetMain,
  getSettingsWindow,
  getActiveTheme: () => getActiveTheme(),
  getLang: () => lang,
  roamFenceSettings,
  roamFencePicker: roamFencePickerRuntime,
  settingsSizePreviewSession,
  isValidSizePreviewKey,
  previewTextScale,
  endTextScalePreview,
  getTextScaleContext: () => ({
    percent: Math.round(
      resolveTextScaleForKey(textScaleByDisplay, textScale, getSettingsDisplayKey()) * 100
    ),
  }),
  sendToRenderer,
  getDoNotDisturb: () => doNotDisturb,
  getSoundMuted: () => soundMuted,
  getSoundVolume: () => soundVolume,
  getAllAgents,
  getHookServerPort: () => getHookServerPort(),
  getRecentHookEvents: (options) => _server.getRecentHookEvents(options),
  checkForUpdates,
  getUpdateCheckSnapshot,
  clearUpdateError,
  copyUpdateError: (copyText) => {
    clipboard.writeText(copyText);
    return { status: "ok" };
  },
  aboutHeroSvgPath: path.join(__dirname, "..", "assets", "svg", "duck-about-hero.svg"),
});

registerSessionIpc({
  ipcMain,
  getSessionSnapshot: () => _state.buildSessionSnapshot(),
  getI18n: () => getDashboardI18nPayload(),
  getDashboardWindow: () => _dashboard.getWindow(),
  focusSession: (sessionId, options) => focusDashboardSession(sessionId, options),
  hideSession: (sessionId) => hideDashboardSession(sessionId),
  openSessionFolder: (sessionId) => openDashboardSessionFolder(sessionId),
  ackSessionCompletion: (sessionId) => _state.ackSessionCompletion(sessionId),
  setSessionAlias: (payload) => _settingsController.applyCommand("setSessionAlias", payload),
  setSessionAutomationOverride: (payload, context) => {
    let warningParent = null;
    try {
      warningParent = BrowserWindow.fromWebContents(context && context.sender);
    } catch {}
    return sessionAutomationCoordinator.setSessionAutomationOverride(payload, { warningParent });
  },
  clearSessionAutomationGrant: (payload) =>
    sessionAutomationCoordinator.clearSessionAutomationGrant(payload),
  showDashboard: (options) => showDashboard(options),
  setSessionHudPinned: (value) => {
    const result = _settingsController.applyUpdate("sessionHudPinned", !!value);
    if (result && typeof result.then === "function") {
      result
        .then((r) => {
          if (r && r.status === "error") console.warn("Duck: failed to pin Session HUD:", r.message);
        })
        .catch((err) => console.warn("Duck: failed to pin Session HUD:", err && err.message));
    } else if (result && result.status === "error") {
      console.warn("Duck: failed to pin Session HUD:", result.message);
    }
  },
});

function createWindow() {
  // Read everything from the settings controller. The mirror caches above
  // (lang/showTray/etc.) were already initialized at module-load time, so
  // here we just need the position/mini fields plus the legacy size migration.
  let prefs = _settingsController.getSnapshot();
  // Legacy S/M/L → P:N migration. Only kicks in for prefs files that haven't
  // been touched since v0; new files always store the proportional form.
  if (SIZES[prefs.size]) {
    const wa = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
    const px = SIZES[prefs.size].width;
    const ratio = Math.round(px / wa.width * 100);
    const migrated = `P:${Math.max(1, Math.min(75, ratio))}`;
    _settingsController.applyUpdate("size", migrated); // subscriber updates currentSize mirror
    prefs = _settingsController.getSnapshot();
  }
  // macOS: apply dock visibility (default visible — but persisted state wins).
  if (isMac) {
    applyDockVisibility();
  }
  const launchSizingWorkArea = getLaunchSizingWorkArea(
    prefs,
    getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA,
    getNearestWorkArea,
  );
  // keepSizeAcrossDisplays preserves the last realized pixel size across restarts.
  const proportionalSize = getCurrentPixelSize(launchSizingWorkArea);
  const size = getLaunchPixelSize(prefs, proportionalSize);
  // #408: seed the in-memory frozen keep-size from the realized launch size, so
  // display events reuse it instead of re-reading transiently-wrong live bounds.
  if (keepSizeAcrossDisplaysCached && isProportionalMode()) {
    keepSizeFrozenPx = { width: size.width, height: size.height };
    // #408 round-2: restore the frozen origin Wa too. Prefer the dedicated
    // savedPixelWorkArea (post-fix prefs); fall back to positionDisplay.workArea
    // for legacy prefs — the next flush will rewrite with the new field.
    const persistedOrigin = snapshotKeepSizeOriginWa(prefs.savedPixelWorkArea);
    if (persistedOrigin) {
      keepSizeFrozenOriginWa = persistedOrigin;
    } else if (prefs.positionDisplay && prefs.positionDisplay.workArea) {
      keepSizeFrozenOriginWa = snapshotKeepSizeOriginWa(prefs.positionDisplay.workArea);
    }
  }

  const {
    initialVirtualBounds,
    initialWindowBounds,
  } = petWindowRuntime.resolveStartupPlacement(prefs, size, {
    restoreMiniFromPrefs: (prefsSnapshot, pixelSize) => _mini.restoreFromPrefs(prefsSnapshot, pixelSize),
  });

  const initialAccessoryDelivery = prepareCurrentAccessorySlotsDelivery();
  petWindowRuntime.createRenderWindow({
    BrowserWindow,
    size,
    initialWindowBounds,
    initialVirtualBounds,
    preloadPath: path.join(__dirname, "preload.js"),
    loadFilePath: path.join(__dirname, "..", "renderer-dist", "index.html"),
    themeConfig: buildRendererThemeConfig(initialAccessoryDelivery.snapshot),
    setRenderWindow: (createdWindow) => { win = createdWindow; },
    isQuitting: () => isQuitting,
    applyDockVisibility,
  });
  finalizePetAccessorySlotsDelivery(initialAccessoryDelivery, true);

  buildContextMenu();
  if (!isMac || showTray) createTray();
  ensureContextMenuOwner();

  // ── Create input window (hitWin) — small rect over hitbox, receives all pointer events ──
  hitWin = petWindowRuntime.createHitWindow({
    BrowserWindow,
    preloadPath: path.join(__dirname, "preload-hit.js"),
    loadFilePath: path.join(__dirname, "shell", "hit.html"),
    hitThemeConfig: themeRuntime.getHitRendererConfig(),
    guardAlwaysOnTop,
    onDidFinishLoad: () => {
      sendToHitWin("theme-config", themeRuntime.getHitRendererConfig());
      if (themeRuntime.isReloadInProgress()) return;
      syncHitStateAfterLoad();
    },
    onRenderProcessGone: (details, ownedHitWin) => {
      safeConsoleError("hitWin renderer crashed:", details.reason);
      petWindowRuntime.setDragLocked(false);
      petWindowRuntime.clearDragSnapshot();
      idlePaused = false;
      mouseOverPet = false;
      petWindowRuntime.reloadWindowWebContents(ownedHitWin, { crashKey: "hitWin", details });
    },
  });

  // Issue #690 plan §4.3.9: these replace (not supplement) the previous
  // synchronous "move"/"resize" -> syncFloatingWindowsAfterPetBoundsChange()
  // wiring. Native move/resize callbacks carry no geometry and must not
  // read/write anything themselves — onNativeGeometryEvent() only
  // (re)schedules a debounced quiet-point reconcile, which is what now calls
  // syncFloatingWindowsAfterPetBoundsChange() (as syncDerivedSurfaces()) once
  // it has classified the settled geometry.
  win.on("move", () => petWindowRuntime.onNativeGeometryEvent());
  win.on("resize", () => petWindowRuntime.onNativeGeometryEvent());
  // §4.3.11: the hit window gets the same geometry-blind debounced treatment,
  // on its own (longer) HIT_QUIET_MS quiet period.
  hitWin.on("move", () => petWindowRuntime.onHitNativeGeometryEvent());
  hitWin.on("resize", () => petWindowRuntime.onHitNativeGeometryEvent());

  syncSessionHudVisibility();

  _petIpc = registerPetInteractionIpc({
    ipcMain,
    showContextMenu: (event) => showPetContextMenu(event),
    moveWindowForDrag: () => moveWindowForDrag(),
    setIdlePaused: (value) => { idlePaused = !!value; },
    setLowPowerIdlePaused,
    setAccessoryMirror: setAccessoryMirrored,
    isMiniTransitioning: () => _mini.getMiniTransitioning(),
    getCurrentState: () => _state.getCurrentState(),
    getCurrentSvg: () => _state.getCurrentSvg(),
    sendToRenderer,
    requestDragReaction,
    requestClickReaction,
    onPetIntent: (intent) => _reachyMini?.handleIntent(intent),
    settleVisual: (event, payload) => {
      if (
        !win
        || win.isDestroyed()
        || !isTrustedMainFrameEvent(event, win.webContents)
      ) return false;
      return displayedVisualProjection.settle(payload);
    },
    recoverVisiblePetAfterRendererLoad: (event) => {
      if (!win || win.isDestroyed()) return;
      if (!event || event.sender !== win.webContents) return;
      if (themeRuntime.isReloadInProgress()) return;
      petWindowRuntime.recoverVisiblePetAfterRendererLoad();
    },
    setDragLocked: (value) => { petWindowRuntime.setDragLocked(value); },
    setMouseOverPet: (value) => { mouseOverPet = !!value; },
    cancelRoam: () => _roam.cancelRoam(),
    expandHitWindowForLift: () => petWindowRuntime.expandHitWindowForLift(),
    beginDragSnapshot: () => beginDragSnapshot(),
    clearDragSnapshot: () => clearDragSnapshot(),
    syncHitWin: () => syncHitWin(),
    syncDisplayedVisualGeometry,
    syncImeEditingPetDodge: () => topmostRuntime.syncImeEditingPetDodge(),
    isMiniMode: () => _mini.getMiniMode(),
    checkMiniModeSnap: () => checkMiniModeSnap(),
    getDisableMiniMode: () => disableMiniModeCached,
    hasPetWindow: () => !!(win && !win.isDestroyed()),
    getPetWindowBounds: () => getPetWindowBounds(),
    getKeepSizeAcrossDisplays: () => keepSizeAcrossDisplaysCached,
    getCurrentPixelSize: () => getCurrentPixelSize(),
    getEffectiveCurrentPixelSize: () => getEffectiveCurrentPixelSize(),
    computeDragEndBounds: (virtualBounds, size) =>
      computeFinalDragBounds(virtualBounds, size, clampToScreenVisual),
    applyPetWindowBounds: (bounds) => applyPetWindowBounds(bounds),
    flushRuntimeStateToPrefs: () => flushRuntimeStateToPrefs(),
    reassertWinTopmost: () => reassertWinTopmost(),
    scheduleHwndRecovery: () => scheduleHwndRecovery(),
    repositionFloatingBubbles: () => repositionFloatingBubbles(),
    exitMiniMode: () => exitMiniMode(),
    getFocusableLocalHudSessionIds: () => getFocusableLocalHudSessionIds(),
    focusLog: (message) => focusLog(message),
    showDashboard: () => showDashboard(),
    focusSession: (sessionId, options) => focusDashboardSession(sessionId, options),
    revealSessionHud: () => {
      if (_sessionHud && typeof _sessionHud.revealFromPet === "function") {
        _sessionHud.revealFromPet();
      }
    },
    statPath: (p) => fs.promises.stat(p),
    openTerminalAt: (dir) => openTerminalAt(dir),
    dropLog: (message) => console.log(`Duck: ${message}`),
  });

  registerPermissionIpc({
    ipcMain,
    permission: _perm,
  });

  registerUpdateBubbleIpc({
    ipcMain,
    updateBubble: _updateBubble,
  });

  initFocusHelper();
  startMainTick();
  // Silently connect any remote SSH profile flagged "connect on launch" once
  // the hook server is ACTUALLY listening and its real port is known.
  // runtime.connect() reads getHookServerPort() synchronously to build the SSH
  // reverse tunnel, and listen() is async — sweeping before the 'listening'
  // event would read a stale fallback port and tunnel to the wrong local port
  // if the bind drifted (port in use, multi-instance). startHttpServer()
  // resolves null when no port could be bound, in which case we skip the sweep.
  // Best-effort: failures fall back to the runtime's own reconnect/backoff and
  // never block startup.
  startHttpServer().then((port) => {
    if (port == null) return;
    const restoredSessionIds = restoreSessionsFromRecoveryLeases(_state, {
      isAgentEnabled: (agentId) => (
        _runtimeAgentGate.isAgentEnabled(agentId)
        && _runtimeAgentGate.isAgentIntegrationInstalled(agentId)
      ),
    });
    if (restoredSessionIds.length > 0) {
      const recoveredSnapshot = _state.buildSessionSnapshot();
      reconcilePowerSaveBlocker();
      broadcastDashboardSessionSnapshot(recoveredSnapshot);
      broadcastSessionHudSnapshot(recoveredSnapshot);
      if (!doNotDisturb && !_mini.getMiniMode()) {
        const recoveredState = resolveDisplayState();
        applyState(recoveredState, getSvgOverride(recoveredState));
      }
      sessionLog(`startup recovery restored sessions=${restoredSessionIds.join(",")}`);
    }
  }).catch(() => {});
  startStaleCleanup();
  // Wait for renderer to be ready before sending initial state
  // If hooks arrived during startup, respect them instead of forcing idle
  // Also handles crash recovery (render-process-gone → reload)
  win.webContents.on("did-start-loading", () => {
    setLowPowerIdlePaused(false);
    // A fresh document draws upright: no .mini-left class, no inline scale on
    // the direction stage. Keeping the old facing here would leave the hit
    // window mirrored against an unmirrored pet until something happens to
    // make the renderer report again.
    setAccessoryMirrored(false);
  });
  win.webContents.on("did-finish-load", () => {
    deliverRendererThemeConfig();
    petWindowRuntime.resendViewportOffsets();
    if (themeRuntime.isReloadInProgress()) return;
    syncRendererStateAfterLoad();
  });

  // ── Crash recovery: renderer process can die from <object> churn ──
  win.webContents.on("render-process-gone", (_event, details) => {
    safeConsoleError("Renderer crashed:", details.reason);
    setLowPowerIdlePaused(false);
    petWindowRuntime.setDragLocked(false);
    idlePaused = false;
    mouseOverPet = false;
    resetDisplayedVisualProjection("renderer-process-gone", { preserveCommitted: true });
    petWindowRuntime.reloadWindowWebContents(win, { crashKey: "renderWin", details });
  });

  guardAlwaysOnTop(win);
  startTopmostWatchdog();
  startFocusablePoll();

  // display-metrics-changed fires in bursts during DPI changes and RDP
  // reconnects, and each one re-clamps/repositions the pet — running them all
  // makes the pet visibly jitter mid-transition. Debounce the geometry handler
  // to the settled state, mirroring the textScale debounce below. (Keep
  // display-removed/added immediate: those rescue the pet off a vanished
  // display and must not be delayed.)
  let displayMetricsGeometryTimer = null;
  const reapplyDisplayGeometryAfterMetricsChange = () => {
    if (displayMetricsGeometryTimer) clearTimeout(displayMetricsGeometryTimer);
    displayMetricsGeometryTimer = setTimeout(() => {
      displayMetricsGeometryTimer = null;
      petWindowRuntime.handleDisplayMetricsChanged();
    }, 400);
  };
  // PR #751 second-review C-6 (Codex non-blocking): §4.3.14's
  // observedClampInset is only valid until the topology it was learned
  // against changes — clearing it (and invalidating the displays cache,
  // B-5) used to wait for the SAME 400ms debounce as the geometry reflow
  // above, so a burst of metrics events could keep re-arming the debounce
  // and delay the clear indefinitely while stale insets kept getting used
  // for clamp classification in the meantime. Both now run immediately, in
  // the raw event callback, decoupled from the (still debounced, to avoid
  // visible jitter) geometry reflow itself. Clearing the whole table here
  // is a safe superset of "clear the affected display's entries" —
  // Electron doesn't cheaply say WHICH display changed from this event
  // alone.
  screen.on("display-metrics-changed", () => {
    petWindowRuntime.clearObservedClampInsets();
    petWindowRuntime.invalidateDisplaysCache();
    reapplyDisplayGeometryAfterMetricsChange();
  });
  // PR #751 second-review C-4 (Codex B4): display-removed/added now also
  // clear the inset table (handleDisplayRemoved()/handleDisplayAdded()
  // themselves do this now, as their own first lines alongside their
  // existing invalidateDisplaysCache() call) — previously only
  // metrics-changed did, leaving a stale inset alive across a monitor
  // unplug/replug or a genuine topology addition.
  screen.on("display-removed", () => petWindowRuntime.handleDisplayRemoved());
  screen.on("display-added", () => petWindowRuntime.handleDisplayAdded());

  // textScale is per-display: when the topology changes, window→display
  // mappings (and therefore effective scales) can change wholesale. Debounced
  // because these events arrive in bursts during reconnects.
  let textScaleTopologyTimer = null;
  const reapplyTextScaleAfterTopologyChange = () => {
    if (textScaleTopologyTimer) clearTimeout(textScaleTopologyTimer);
    textScaleTopologyTimer = setTimeout(() => {
      textScaleTopologyTimer = null;
      applyTextScaleNow();
    }, 400);
  };
  screen.on("display-metrics-changed", reapplyTextScaleAfterTopologyChange);
  screen.on("display-removed", reapplyTextScaleAfterTopologyChange);
  screen.on("display-added", reapplyTextScaleAfterTopologyChange);
}

// Read primary display safely — getPrimaryDisplay() can also throw during
// display topology changes, so wrap it. Returns null on failure; the pure
// helpers in work-area.js will fall through to a synthetic last-resort.
function getPrimaryWorkAreaSafe() {
  try {
    const primary = screen.getPrimaryDisplay();
    return (primary && primary.workArea) || null;
  } catch {
    return null;
  }
}

function getBubbleWorkArea(followPet, petBounds) {
  return resolveBubbleWorkArea({
    followPet,
    petBounds: petBounds || getPetWindowBounds(),
    getPrimaryWorkArea: getPrimaryWorkAreaSafe,
    getNearestWorkArea,
    syntheticWorkArea: SYNTHETIC_WORK_AREA,
  });
}

function getTextScaleForBubbleWorkArea(workArea) {
  const displayKey = isUsableBubbleWorkArea(workArea)
    ? getDisplayKeyForBounds(workArea)
    : null;
  return effectiveTextScaleForKey(displayKey || getPetDisplayKey());
}

function getNearestWorkArea(cx, cy) {
  return findNearestWorkArea(screen.getAllDisplays(), getPrimaryWorkAreaSafe(), cx, cy);
}

function clampToScreenVisual(x, y, w, h, options = {}) { return petWindowRuntime.clampToScreenVisual(x, y, w, h, options); }
function clampToScreen(x, y, w, h) { return petWindowRuntime.clampToScreen(x, y, w, h); }

function computeFinalDragBounds(bounds, size, clampPosition = clampToScreenVisual) {
  return petWindowRuntime.computeFinalDragBounds(bounds, size, clampPosition);
}

// ── Mini Mode — initialized here after state module ──
const _miniCtx = {
  get theme() { return getActiveTheme(); },
  get win() { return win; },
  get currentSize() { return currentSize; },
  get doNotDisturb() { return doNotDisturb; },
  set doNotDisturb(v) { doNotDisturb = v; },
  get currentState() { return _state.getCurrentState(); },
  notifyUpdaterSilentExit: () => notifyUpdaterSilentExit(),
  SIZES,
  getCurrentPixelSize,
  getEffectiveCurrentPixelSize,
  getPixelSizeFor,
  isProportionalMode,
  sendToRenderer,
  sendToHitWin,
  syncHitWin,
  applyState,
  resolveDisplayState,
  getSvgOverride,
  stopWakePoll,
  clampToScreenVisual,
  getNearestWorkArea,
  getPetWindowBounds,
  applyPetWindowBounds,
  applyPetWindowPosition,
  setViewportOffsetY,
  // Issue #690 plan §4.3.10's mini transition+animation reconcile protection
  // period release point (mirrors _roamCtx's identical wiring below).
  releaseReconcileProtection: () => petWindowRuntime.releaseReconcileProtection(),
  get bubbleFollowPet() { return bubbleFollowPet; },
  get pendingPermissions() { return pendingPermissions; },
  repositionBubbles: () => repositionFloatingBubbles(),
  syncSessionHudVisibility: () => syncSessionHudVisibilityAndBubbles(),
  repositionSessionHud: () => repositionSessionHud(),
  buildContextMenu: () => buildContextMenu(),
  buildTrayMenu: () => buildTrayMenu(),
  getAnimationAssetCycleMs: (file) => {
    if (!file) return null;
    const probe = animationOverridesMain && typeof animationOverridesMain.buildAnimationAssetProbe === "function"
      ? animationOverridesMain.buildAnimationAssetProbe(file)
      : null;
    return Number.isFinite(probe && probe.assetCycleMs) && probe.assetCycleMs > 0
      ? probe.assetCycleMs
      : null;
  },
};
const _mini = require("./shell/mini")(_miniCtx);

const handleTestResult = createTestReactionHandler({
  getEnabled: () => _settingsController.get("testReactionsEnabled") === true,
  getDoNotDisturb: () => doNotDisturb,
  isPetHidden: () => petWindowRuntime.isPetEffectivelyHidden(),
  getMiniMode: () => _mini.getMiniMode(),
  getMiniTransitioning: () => _mini.getMiniTransitioning(),
  isDragging: () => petWindowRuntime.isDragLocked(),
  hasPetWindow: () => !!(win && !win.isDestroyed()),
  sendToRenderer,
});
const { enterMiniMode, exitMiniMode, enterMiniViaMenu, miniPeekIn, miniPeekOut,
        checkMiniModeSnap, cancelMiniTransition, animateWindowX, animateWindowParabola } = _mini;

// ── Free Roam — initialized here after state and mini modules ──
// duck-on-desk: the 3D renderer reports the duck's facing (rad, camera bearing
// relative to its forward axis; > 0 means the beak points to the viewer's left)
// so free roam walks toward the side the duck already leans to.
let duckFacing = 0;
ipcMain.on('duck-action-status', (event, status) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
  duckActionStatus = {ready:status?.ready===true,busy:status?.busy!==false};
  rebuildAllMenus();
});
ipcMain.on("duck-facing", (event, value) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  duckFacing = Number.isFinite(value) ? value : 0;
});

// duck-on-desk: while roaming the window follows the duck's own stride — the
// renderer reports how far the trunk actually walked (screen px) and roam.js
// applies it instead of tweening along its own path.
ipcMain.on("duck-displacement", (event, d) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  _roam.onDisplacement(d && Number.isFinite(d.dx) ? d.dx : 0, d && Number.isFinite(d.dy) ? d.dy : 0);
});

// duck-on-desk: launch arguments are only a snapshot, so the renderer re-reads
// the current pet prefs on every reload. Both robots ask for this, so it lives
// with the other pet IPC and not in the Reachy adapter, which gets disposed.
ipcMain.handle("pet-runtime-config", (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return null;
  return {
    duckActions: duckActionCatalog(),
    duckRandomActions: _settingsController.get('duckRandomActions'),
    labPolicyUrl: getLabJobs().activation().current ? `pet-model://policy/${encodeURIComponent(`lab/${getLabJobs().activation().current}/policy.onnx`)}` : null,
    petRobot: _settingsController.get("petRobot"),
    reachyAutoConnect: _settingsController.get("reachyAutoConnect"),
    reachyHost: _settingsController.get("reachyHost"),
    duckMuted: _settingsController.get("duckMuted"),
    duckVoiceVolume: _settingsController.get("duckVoiceVolume"),
    duckStepVolume: _settingsController.get("duckStepVolume"),
    duckAppearance: _settingsController.get("duckAppearance"),
    duckLocomotion: _settingsController.get("duckLocomotion"),
    duckStilts: _settingsController.get("duckStilts"),
  };
});

const _roamCtx = {
  duckDrivesRoam: true,
  // Only bounds the walk's timeout now (window motion comes from the duck).
  roamSpeedPxPerMs: 0.02,
  // -1 = walk left, +1 = walk right, 0 = no preference (facing within ±0.15 rad of the camera).
  getDuckLean: () => (duckFacing > 0.15 ? -1 : duckFacing < -0.15 ? 1 : 0),
  get win() { return win; },
  get dragLocked() { return petWindowRuntime.isDragLocked(); },
  getPetWindowBounds,
  applyPetWindowBounds,
  // #569: lets roam anchor to the keep-size frozen size when that toggle is on
  getEffectiveCurrentPixelSize,
  syncHitWin: () => syncHitWin(),
  // Issue #690 plan §4.3.10's roam protection-period release point.
  releaseReconcileProtection: () => petWindowRuntime.releaseReconcileProtection(),
  repositionSessionHud: () => repositionSessionHud(),
  repositionAnchoredSurfaces: () => repositionAnchoredFloatingSurfaces(),
  repositionBubbles: () => repositionFloatingBubbles(),
  get bubbleFollowPet() { return bubbleFollowPet; },
  get pendingPermissions() { return pendingPermissions; },
  getNearestWorkArea,
  clampToScreenVisual,
  getMiniMode: () => _mini.getMiniMode(),
  // Reachy Mini has no mobile base: the window must not wander off on its own.
  canRoam: () => _settingsController.get("petRobot") !== "reachy-mini",
  getCurrentState: () => _state.getCurrentState(),
  get miniTransitioning() { return _mini.getMiniTransitioning(); },
  applyState: (state, svgOverride, opts) => _state.applyState(state, svgOverride, opts),
  setState: (state, svgOverride, opts) => _state.setState(state, svgOverride, opts),
  setRoamHeading: (headingLeft) => sendToRenderer("roam-heading", !!headingLeft),
  // #640: hold still while the user types into a bubble text field (macOS)
  isImeEditingActive: () => pendingPermissions.some(
    (p) => p
      && p.bubble
      && !p.bubble.isDestroyed()
      && p.bubble.isVisible()
      && p.bubble.__duckMacImeEditing
  ),
  hasVisiblePermissionBubbles: () => _perm.hasVisiblePermissionBubbles(),
  // #810: optional roam fence — validated async loader for
  // ~/.duck-on-desk/roam-area.json; roam reads its in-memory cache at target pick
  // time and kicks refresh() when scheduling walks (see src/robots/duck/roam-fence.js).
  roamFence: roamFenceLoader,
};
const _roam = require("./robots/duck/roam")(_roamCtx);
_reachyMini = require("./robots/reachy/reachy-mini-main").createReachyMiniMain({
  ipcMain, settings: _settingsController, getWindow: () => win, sendToRenderer,
});
// State may have settled before the adapter was constructed. Seed the current
// intent without replaying a historical notification or error sound.
_reachyMini.handleSemanticState(_state.getCurrentState(), { initial: true });
const { createRobotPowerControl, createRobotErrorNotifier } = require("./robots/reachy/robot-power-control");
robotPowerControl = createRobotPowerControl({
  getAdapter: () => _settingsController.get("petRobot") === "reachy-mini" ? _reachyMini : null,
  wakeDesktop: () => _state.wakeRobot(),
});
// An automatic sleep/wake that failed is otherwise invisible; the explicit menu
// wake is still busy when it publishes, and shows its own dialog instead.
const notifyRobotError = createRobotErrorNotifier({
  showError: (detail) => { void electronDialog.showMessageBox({ type: "error", message: t("robotActionFailed"), detail }); },
  isExplicitWake: () => robotPowerControl.isBusy(),
});
let lastRobotPowerState = "";
_reachyMini.client.on("status", status => {
  const key = `${status.connected}:${status.motionEnabled}`;
  if (key !== lastRobotPowerState) { lastRobotPowerState = key; rebuildAllMenus(); }
  notifyRobotError(status);
});
// #810: resolve the fence's initial status right away so the first roam
// round doesn't have to hold on an UNKNOWN state (get() === null) when a
// fence file exists — or confirm quickly that none does.
_roamCtx.roamFence.refresh();

// Free roam: initialize from prefs and react to toggle changes
_roam.setEnabled(_settingsController.get("freeRoam") === true);
_roam.setConstrainAxis(_settingsController.get("roamConstrainAxis") === true);
try {
  _settingsController.subscribeKey("freeRoam", (value) => {
    _roam.setEnabled(value === true);
  });
  _settingsController.subscribeKey("roamConstrainAxis", (value) => {
    _roam.setConstrainAxis(value === true);
  });
} catch (err) {
  console.warn("Duck: freeRoam subscribeKey failed:", err && err.message);
}

// Convenience getters for mini state (used throughout main.js)
Object.defineProperties(this || {}, {}); // no-op placeholder
// Mini state is accessed via _mini getters in ctx objects below

// ── Theme switching ──
//
// The settings controller calls themeRuntime.activateTheme through lazy
// injected deps. main.js remains the composition root; theme-runtime owns the
// active theme source and the cleanup/refresh/reload protocol.

// ── Auto-install VS Code / Cursor terminal-focus extension ──
const EXT_ID = "duck.duck-terminal-focus";
const EXT_VERSION = "0.1.1";
const EXT_DIR_NAME = `${EXT_ID}-${EXT_VERSION}`;

function installTerminalFocusExtension() {
  const os = require("os");
  const home = os.homedir();

  // Extension source — in dev: ../extensions/vscode/, in packaged: app.asar.unpacked/
  let extSrc = path.join(__dirname, "..", "extensions", "vscode");
  extSrc = extSrc.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);

  if (!fs.existsSync(extSrc)) {
    console.log("Duck: terminal-focus extension source not found, skipping auto-install");
    return;
  }

  const targets = [
    path.join(home, ".vscode", "extensions"),
    path.join(home, ".cursor", "extensions"),
  ];

  const filesToCopy = ["package.json", "extension.js"];
  let installed = 0;

  for (const extRoot of targets) {
    if (!fs.existsSync(extRoot)) continue; // editor not installed
    const dest = path.join(extRoot, EXT_DIR_NAME);
    // Skip if already installed (check package.json exists)
    if (fs.existsSync(path.join(dest, "package.json"))) continue;
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const file of filesToCopy) {
        fs.copyFileSync(path.join(extSrc, file), path.join(dest, file));
      }
      installed++;
      console.log(`Duck: installed terminal-focus extension to ${dest}`);
    } catch (err) {
      console.warn(`Duck: failed to install extension to ${dest}:`, err.message);
    }
  }
  if (installed > 0) {
    console.log(`Duck: terminal-focus extension installed to ${installed} editor(s). Restart VS Code/Cursor to activate.`);
  }
}

// ── Single instance lock ──
app.on("open-url", (event, url) => {
  event.preventDefault();
  codexPetMain.enqueueImportUrl(url);
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  if (process.argv.includes(REGISTER_PROTOCOL_DEV_ARG)) {
    const protocolRegistered = codexPetMain.registerProtocolClient();
    console.log(`Duck: duck:// dev protocol registration ${protocolRegistered ? "succeeded" : "failed"}`);
  }
  // Another instance is already running — quit silently
  app.quit();
} else {
  // Only the winning instance may publish the startup gate. A losing instance
  // can have a stale/default prefs snapshot and must never become the final
  // writer after the active instance has disabled Codex.
  // A future-version, recovered, or partially malformed snapshot is not
  // authoritative enough to publish an enabled external gate. The evaluator
  // latches that decision for this process; only a clean restart can reopen it.
  const startupGateSnapshot = (
    _initialPrefsLoad.locked === true
    || _initialPrefsLoad.recovered === true
    || _initialPrefsLoad.codexAutoStartAuthoritative === false
  ) ? null : _initialPrefsLoad.snapshot;
  _syncCodexAutoStartGate(startupGateSnapshot, "startup");
  app.on("second-instance", (_event, commandLine) => {
    if (petWindowRuntime.isPetEffectivelyHidden()) {
      prepManualPetVisibility();
      petWindowRuntime.setPetHidden(false);
    } else {
      if (win) {
        win.showInactive();
        keepOutOfTaskbar(win);
      }
      if (hitWin && !hitWin.isDestroyed()) {
        hitWin.showInactive();
        keepOutOfTaskbar(hitWin);
      }
      // #525: relaunching while the pet is nominally visible is a "where is my
      // pet?" signal — showInactive() alone cannot clear a DWM cloak, so run
      // the cloak recovery path too.
      petWindowRuntime.recoverIfCloaked();
    }
    if (shouldOpenSettingsWindowFromArgv(commandLine)) {
      settingsWindowRuntime.openWhenReady();
    }
    codexPetMain.enqueueImportUrlsFromArgv(commandLine);
    reapplyMacVisibility();
  });

  // Before app readiness, keep a tray-only launch out of Dock. Once a lab
  // exists, the shared coordinator owns the visibility override.
  if (isMac && app.dock) {
    if (_settingsController.get("showDock") === false && !robotLabRuntime.getWindow()) {
      app.dock.hide();
    }
  }

  // ── Codex official-hook health nudge ──
  //
  // Codex approval awareness now depends entirely on the official
  // PermissionRequest hook (the JSONL approval heuristic was removed). If that
  // hook silently failed to register — or [features].hooks=false, or it needs
  // Codex /hooks review — the user gets NO approval prompts and no fallback.
  // Nudge once, edge-triggered: notify only when the breakage KIND changes
  // (deduped via the persisted signature) and reset when healthy, so a broken
  // hook warns at most once per distinct breakage, never every launch. The
  // Windows tray balloon is the active nudge; the Agents-tab badge is the
  // always-on, cross-platform surface.
  function fireCodexHookNudge(verdict) {
    try {
      const tray = _menu && typeof _menu.getTray === "function" ? _menu.getTray() : null;
      if (process.platform === "win32") {
        trayBalloonOwner.show(tray, {
          iconType: "warning",
          title: t("codexHookHealthNudgeTitle"),
          content: t("codexHookHealthNudgeBody"),
        });
      }
    } catch (err) {
      console.warn("Duck: Codex hook balloon failed:", err && err.message);
    }
    console.warn(`Duck: Codex official hook needs attention (${verdict.signature}): ${verdict.detailText || ""}`);
  }

  function maybeNudgeCodexHookHealth() {
    try {
      const { getCodexHookHealth, decideCodexHookNotification } = require("./state/codex-hook-health");
      const snapshot = _settingsController.getSnapshot();
      const verdict = getCodexHookHealth({ prefs: snapshot });
      const prevSignature = _settingsController.get("codexHookHealthLastNotified") || "";
      const decision = decideCodexHookNotification(verdict, prevSignature, {
        codexEnabled: _runtimeAgentGate.isAgentEnabled("codex"),
        notifyEnabled: _settingsController.get("codexHookHealthNotifyEnabled") !== false,
      });
      if (decision.nextSignature !== prevSignature) {
        _settingsController.applyUpdate("codexHookHealthLastNotified", decision.nextSignature);
      }
      if (decision.shouldNotify) fireCodexHookNudge(verdict);
    } catch (err) {
      console.warn("Duck: Codex hook health nudge failed:", err && err.message);
    }
  }

  function notifyPrefsAuthorityFailure() {
    const readFailure = _settingsController.hasReadFailure();
    if (!readFailure && !_initialPrefsRecovered) return false;
    const title = translate(_initialPrefsRecoveryBackupFailed
      ? "prefsRecoveryBackupFailedNudgeTitle"
      : (readFailure ? "prefsReadFailureNudgeTitle" : "prefsRecoveredNudgeTitle"));
    const body = translate(_initialPrefsRecoveryBackupFailed
      ? "prefsRecoveryBackupFailedNudgeBody"
      : (readFailure ? "prefsReadFailureNudgeBody" : "prefsRecoveredNudgeBody"));
    const onClick = () => settingsWindowRuntime.open();
    try {
      const tray = _menu && typeof _menu.getTray === "function" ? _menu.getTray() : null;
      if (process.platform === "win32" && trayBalloonOwner.show(tray, {
        iconType: "warning",
        title,
        content: body,
        onClick,
      })) {
        return true;
      }
      if (Notification && typeof Notification.isSupported === "function" && Notification.isSupported()) {
        const notification = new Notification({ title, body });
        notification.once("click", onClick);
        notification.show();
        return true;
      }
    } catch (err) {
      console.warn("Duck: preferences authority nudge failed:", err && err.message);
    }
    console.warn(`Duck: ${body}`);
    return false;
  }

  app.whenReady().then(async () => {
    petModelProtocol.installHandler(protocol, net, pathToFileURL, { resolveLabPolicy: (id) => getLabJobs().artifact(id),
      // Policies ship with the app (scripts/fetch-policies.js stages them); the
      // user's Hugging Face cache still wins when it has them.
      bundledDir: app.isPackaged ? path.join(process.resourcesPath, "policies") : path.join(__dirname, "..", "models", "bundled"),
    });
    // Older macOS and development builds retain the padded runtime icon from
    // #416. Packaged Tahoe+ leaves the Dock untouched so macOS can apply the
    // user's Default/Dark/Clear/Tinted treatment to the bundle icon (#941).
    const installRuntimeDockIcon = resolveRuntimeDockIconPolicy({
      platform: process.platform,
      isPackaged: app.isPackaged === true,
      getSystemVersion: () => process.getSystemVersion(),
    });
    installStartupDockIcon({
      dock: app.dock,
      showDock: _settingsController.get("showDock") !== false,
      dockIconPath: path.join(__dirname, "..", "assets", "dock-icon.png"),
      installRuntimeIcon: installRuntimeDockIcon,
    });

    const protocolRegistered = codexPetMain.registerProtocolClient();
    if (process.argv.includes(REGISTER_PROTOCOL_DEV_ARG)) {
      console.log(`Duck: duck:// dev protocol registration ${protocolRegistered ? "succeeded" : "failed"}`);
      app.quit();
      return;
    }

    // Import system-backed settings (openAtLogin) into prefs on first run.
    // Must run before createWindow() so the first menu draw sees the
    // hydrated value rather than the schema default.
    hydrateSystemBackedSettings();
    // First-run only: seed UI language from the device locale, before createWindow
    // so the very first menu/tray render is already in the user's language.
    hydrateFreshInstallLanguage();
    permDebugLog = path.join(app.getPath("userData"), "permission-debug.log");
    updateDebugLog = path.join(app.getPath("userData"), "update-debug.log");
    sessionDebugLog = path.join(app.getPath("userData"), "session-debug.log");
    focusDebugLog = path.join(app.getPath("userData"), "focus-debug.log");
    const { createWindowsProcessChainShadowLogger } = require("./state/windows-process-chain-shadow-log");
    recordWindowsProcessChainShadow = createWindowsProcessChainShadowLogger({
      filePath: path.join(app.getPath("userData"), "windows-process-chain-shadow.log"),
    });
    createWindow();
    notifyPrefsAuthorityFailure();
    holidayAccessoryRuntime.start();
    // WSL agent detection is NOT started here: scanning runs a command inside
    // every installed distro, which boots each stopped VM — too aggressive for
    // app launch. The first Settings→Agents visit triggers the scan instead
    // (see fetchAgentInstallationHints in settings-ui-core.js).
    systemWakeRecovery = createSystemWakeRecovery({
      powerMonitor,
      ipcMain,
      sendToRenderer,
      onRecovered: () => {
        setLowPowerIdlePaused(false);
        // The main mirror can already be false while the renderer still owns a
        // paused SVG. Always resend the latest cursor position after receipt.
        setForceEyeResend(true);
      },
      log: sessionLog,
      onError: (err) => safeConsoleError(
        "Duck: system wake recovery failed:",
        err && err.message ? err.message : err
      ),
    });
    systemWakeRecovery.start();
    // #525: sleep/wake and lock/unlock are prime DWM-cloak moments. Hang the
    // cloak recovery directly on powerMonitor rather than onRecovered above:
    // onRecovered only fires after a renderer round-trip and is skipped on
    // timeout (system-wake-recovery.js finishWithTimeout), while un-cloaking is
    // a main-process concern that must not depend on renderer health. The two
    // paths coexist; recoverIfCloaked() is a no-op when nothing is cloaked.
    if (isWin) {
      powerMonitor.on("resume", () => petWindowRuntime.recoverIfCloaked());
      powerMonitor.on("unlock-screen", () => petWindowRuntime.recoverIfCloaked());
    }
    // macOS: bridge the OS app-hidden state (⌘H / Dock right-click → 隐藏) to the
    // pet. Pet windows are setCanHide:NO, so the OS marks the app hidden but the
    // windows refuse to vanish, and an inactive-app Dock Hide fires no
    // did-resign-active — so we poll app.isHidden() and drive setPetHidden(). (#416)
    if (isMac) {
      macHideController = createMacHideController({
        isMac,
        app,
        getShowDock: () => showDock,
        isPetHidden: () => petWindowRuntime.isPetHidden(),
        setPetHidden: (hidden) => petWindowRuntime.setPetHidden(hidden),
      });
      macHideController.start();
      app.on("activate", () => { if (macHideController) macHideController.onActivate(); });
    }
    if (shouldOpenSettingsWindowFromArgv(process.argv)) {
      settingsWindowRuntime.open();
    }
    codexPetMain.enqueueImportUrlsFromArgv(process.argv);
    codexPetMain.flushPendingImportUrls().catch((err) => {
      console.warn("Duck: Codex Pet import queue failed:", err && err.message);
    });

    // Register persistent global shortcuts from the validated prefs snapshot.
    shortcutRuntime.registerPersistentShortcutsFromSettings();

    // Construct log monitors. We always instantiate them so toggling the
    // agent on/off later can call start()/stop() without paying the require
    // cost at click time. Whether we call .start() right now depends on the
    // agent-gate snapshot — a user who disabled Codex at last shutdown
    // shouldn't see its file watcher spin up on the next launch.
    agentRuntime.startCodexLogMonitor();

    // Auto-install VS Code/Cursor terminal-focus extension
    try { installTerminalFocusExtension(); } catch (err) {
      console.warn("Duck: failed to auto-install terminal-focus extension:", err.message);
    }

    // Auto-updater: setup event handlers (user triggers check via tray menu)
    setupAutoUpdater();
    // #329: reconcile any stale pending-update entry (e.g. user installed
    // out-of-band on macOS) and start the background scheduler. Both are
    // safe in dev mode — reconcile is a no-op when nothing is pending,
    // and startUpdateScheduler() short-circuits on !app.isPackaged.
    try { reconcilePendingOnStartup(); } catch (err) { updateLog(`reconcile failed: ${err && err.message}`); }
    try { startUpdateScheduler(); } catch (err) { updateLog(`scheduler start failed: ${err && err.message}`); }

    // Deferred so any startup Codex hook sync has settled before we read the
    // on-disk hook state; unref'd so it never blocks a fast quit.
    const codexHookNudgeTimer = setTimeout(maybeNudgeCodexHookHealth, 4000);
    if (codexHookNudgeTimer && typeof codexHookNudgeTimer.unref === "function") codexHookNudgeTimer.unref();
  });

  app.on("before-quit", (event) => {
    labJobs?.dispose();
    isQuitting = true;
    if (quitCleanupStarted) return;
    quitCleanupStarted = true;
    trayBalloonOwner.dispose();
    holidayAccessoryRuntime.dispose();
    if (systemWakeRecovery) systemWakeRecovery.dispose();
    // #525: release the IVirtualDesktopManager COM ref and pay back our own
    // CoInitializeEx count (see win-cloak-recovery.js dispose()).
    _cloakInspector.dispose();
    try { stopUpdateScheduler(); } catch {}
    releasePowerSaveBlocker();
    flushRuntimeStateToPrefs();
    globalShortcut.unregisterAll();
    void settingsSizePreviewSession.cleanup();
    permissionAutomationConfirmationRuntime.dispose();
    roamFencePickerRuntime.dispose();
    try { settingsIpcRuntime.dispose(); } catch (err) {
      console.error("settings IPC shutdown failed:", err && err.message);
    }
    _perm.cleanup();
    _server.cleanup();
    _updateBubble.cleanup();
    if (displayedVisualProjection) displayedVisualProjection.dispose();
    _state.cleanup();
    _reachyMini.dispose();
    _tick.cleanup();
    _mini.cleanup();
    if (macHideController) macHideController.stop();
    _sessionHud.cleanup();
    agentRuntime.cleanup();
    topmostRuntime.cleanup();
    themeRuntime.cleanup();
    _focus.cleanup();
    if (animationOverridesMain) animationOverridesMain.cleanup();
    if (hitWin && !hitWin.isDestroyed()) hitWin.destroy();
  });

  app.on("window-all-closed", () => {
    if (!isQuitting) return;
    app.quit();
  });
}
