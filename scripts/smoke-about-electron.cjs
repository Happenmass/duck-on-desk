'use strict';
// Runs only settings and a virtual lab, never src/main.js, hooks, hardware or the user's profile.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = process.env.DUCK_SMOKE_APP_ROOT || path.join(__dirname, '..');
const labRoot = process.env.DUCK_SMOKE_LAB_ROOT || path.join(root, 'mcp/robot-lab');
const expectedVersion = require(path.join(root, 'package.json')).version;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-about-smoke-'));
const output = path.resolve(process.env.DUCK_SMOKE_OUTPUT || path.join(os.tmpdir(), `duck-about-${expectedVersion}`));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(tmp, 'profile'));
const policies = require(path.join(root, 'src/robots/duck/pet-model-protocol'));
policies.registerScheme(protocol);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { if (await fn()) return; await wait(100); }
  throw new Error('Timed out waiting for settings/lab');
}
const report = { timestamp: new Date().toISOString(), scope: 'isolated settings + virtual laboratory', errors: [] };
let win, lab, controller, jobs, settingsIpc, dockMenu;
app.whenReady().then(async () => {
  try {
    policies.installHandler(protocol, net, pathToFileURL);
    jobs = require(path.join(labRoot, 'jobs.cjs')).createLabJobs({ root: path.join(tmp, 'jobs') });
    lab = require(path.join(root, 'src/shell/robot-lab-window')).createRobotLabWindow({ app, BrowserWindow, ipcMain, dialog: {}, getJobs: () => jobs, onWindowChanged: () => dockMenu.applyDockVisibility() });
    dockMenu = require(path.join(root, 'src/shell/menu'))({ showDock: false, getRobotLabWindow: () => lab.getWindow(), getSettingsWindow: () => win, reapplyMacVisibility() {} });
    await dockMenu.applyDockVisibility();
    controller = require(path.join(root, 'src/shell/settings-controller')).createSettingsController({
      prefsPath: path.join(tmp, 'prefs.json'), injectedDeps: { openRobotLab: () => lab.open() },
    });
    controller.applyUpdate('lang', 'zh');
    controller.subscribe(payload => win?.webContents.send('settings-changed', payload));
    controller.subscribeKey('developerMode', enabled => enabled ? lab.open() : lab.close());
    win = new BrowserWindow({ width: 800, height: 680, show: true, webPreferences: {
      preload: path.join(root, 'src/preload-settings.js'), contextIsolation: true, sandbox: true,
    } });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    settingsIpc = require(path.join(root, 'src/shell/settings-ipc')).registerSettingsIpc({
      ipcMain, settingsController: controller, app: { getVersion: () => expectedVersion }, BrowserWindow,
      themeLoader: { listThemesWithMetadata: () => [], getPreviewSoundUrl: () => null },
      codexPetMain: { decorateThemeMetadata: theme => theme }, dialog: {}, shell: {},
      roamFenceSettings: { getStatus: () => ({ status: 'ok', active: false, fence: null }) },
      roamFencePicker: {}, settingsSizePreviewSession: {}, isValidSizePreviewKey: () => true,
      getAllAgents: () => [], detectAgentInstallations: () => [], getSettingsWindow: () => win,
    });
    ipcMain.handle('settings:getShortcutFailures', () => ({}));
    ipcMain.handle('doctor:get-report', () => null);
    ipcMain.handle('doctor:run-checks', () => ({ checks: [] }));
    await win.loadFile(path.join(root, 'src/shell/settings.html'));
    const run = script => win.webContents.executeJavaScript(script);
    await until(() => run('Boolean(globalThis.DuckSettingsCore?.state.snapshot?.lang)'));
    win.webContents.send('settings:select-tab', 'about');
    await until(() => run('Boolean(document.querySelector(".about-developer-mode-switch"))'));
    await until(() => run('document.querySelector(".about-crab-wrap img")?.naturalWidth > 0'));
    report.metadata = await run('window.settingsAPI.getAboutInfo()');
    assert.equal(report.metadata.version, expectedVersion);
    assert.equal(report.metadata.authorName, 'Happenmass');
    assert.equal(report.metadata.developerMode, false);
    assert.equal(lab.getWindow(), null);
    const text = await run('document.querySelector("#content").textContent');
    assert.ok(text.includes('@Happenmass') && text.includes('@rullerzhou-afk'));
    await wait(300);
    fs.writeFileSync(path.join(output, 'about-off.png'), (await win.webContents.capturePage()).toPNG());
    await run('document.querySelector(".about-developer-mode-switch").click();true');
    await until(() => lab.getWindow());
    const first = lab.getWindow();
    await until(() => first.webContents.executeJavaScript('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
    assert.equal(controller.get('developerMode'), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'prefs.json'), 'utf8')).developerMode, true);
    report.enabledAndPersisted = true;
    report.labReady = true;
    if (process.platform === 'darwin') { report.labDockVisible = app.dock.isVisible(); assert.equal(report.labDockVisible, true); }
    await wait(300);
    fs.writeFileSync(path.join(output, 'about-on.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(640, 680);
    await wait(300);
    report.narrowLayout = await run('document.querySelector("#content").scrollWidth <= document.querySelector("#content").clientWidth');
    assert.equal(report.narrowLayout, true, 'About must fit the minimum settings width');
    fs.writeFileSync(path.join(output, 'about-narrow.png'), (await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'laboratory.png'), (await first.webContents.capturePage()).toPNG());
    first.destroy();
    await run('document.querySelector(".about-open-lab").click();true');
    await until(() => lab.getWindow());
    assert.notEqual(lab.getWindow(), first);
    report.reopened = true;
    await run('document.querySelector(".about-developer-mode-switch").click();true');
    await until(() => lab.getWindow() === null && controller.get('developerMode') === false);
    report.disabledAndDestroyed = true;
    await dockMenu.applyDockVisibility();
    if (process.platform === 'darwin') { report.labDockHiddenAfterDisable = !app.dock.isVisible(); assert.equal(report.labDockHiddenAfterDisable, true); }
    await run('document.querySelector(".about-upstream-trigger").click();true');
    await wait(300);
    report.upstreamVisible = await run('document.querySelector(".about-upstream-trigger").getAttribute("aria-expanded") === "true"');
    assert.equal(report.upstreamVisible, true);
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) { report.ok = false; report.error = error.stack; }
  finally {
    settingsIpc?.dispose(); lab?.dispose(); win?.destroy(); controller?.dispose(); jobs?.dispose();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(report.ok ? 0 : 1);
  }
});
