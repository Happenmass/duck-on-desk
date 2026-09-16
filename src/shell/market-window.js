'use strict';
// The action market window. Read-only in this milestone: it lists community
// Microduck policies, shows what each one declares, and links out to the Hub.
// Nothing is downloaded and nothing reaches the pet from here yet.
const path = require('node:path');

const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

function createMarketWindow({ app, BrowserWindow, ipcMain, shell, getCatalog, getInstaller, getStore, openLab = () => {}, devUrl = null }) {
  let window = null;
  let inFlight = null;

  function showAndFocus() {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized && window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
  function onActivate() {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized() || !window.isVisible() || !BrowserWindow.getFocusedWindow()) showAndFocus();
  }
  if (app.on) app.on('activate', onActivate);

  const trusted = (event) => window && !window.isDestroyed()
    && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame;

  ipcMain.handle('market:request', async (event, { action, payload = {} } = {}) => {
    if (!trusted(event)) throw new Error('Market requests require the market window');
    try {
      switch (action) {
        case 'list': {
          // Two windows-worth of clicks must not become two listing fetches.
          if (!inFlight || payload.force === true) {
            inFlight = getCatalog().list({ force: payload.force === true })
              .finally(() => { inFlight = null; });
          }
          return await inFlight;
        }
        case 'installed': return getStore().list();
        case 'install': {
          // Only what the catalogue itself judged usable may be downloaded; the
          // renderer cannot hand in a repository the classifier never saw.
          const { entries } = await getCatalog().list({});
          const entry = entries.find((item) => item.repo === payload.repo);
          if (!entry || entry.status !== 'ready') throw new Error('这个策略尚未确认可用，不能下载');
          if (entry.revision && entry.revision !== payload.revision) throw new Error('这个策略已经有新版本，请刷新后重试');
          const installed = await getInstaller().install(entry.repo, entry.sha);
          return getStore().record({
            repo: entry.repo, revision: entry.sha, name: entry.title,
            kind: entry.kind, commandMode: entry.commandMode, duration: entry.duration,
            sha256: installed.sha256, file: installed.file,
          });
        }
        case 'forget': {
          const entry = getStore().list().find((item) => item.id === payload.id);
          if (!entry) throw new Error('这个动作不在已下载列表中');
          getStore().forget(entry.id);
          getInstaller().remove(entry.repo, entry.revision);
          return getStore().list();
        }
        // Trying a downloaded policy happens in the laboratory, where there is a
        // simulated duck to run it on; the market never plays anything itself.
        case 'open-lab': { openLab(); return { opened: true }; }
        case 'open-repository': {
          // Only ever a Hub repository page, built here rather than taken as a URL.
          if (typeof payload.repo !== 'string' || !REPO.test(payload.repo)) throw new Error('Unknown repository');
          await shell.openExternal(`https://huggingface.co/${payload.repo}`);
          return { opened: true };
        }
        default: throw new Error('Unknown market action');
      }
    } catch (error) { return { error: error.message }; }
  });

  function open() {
    if (window && !window.isDestroyed()) { showAndFocus(); return; }
    window = new BrowserWindow({
      width: 1280, height: 880, minWidth: 900, minHeight: 620, title: '动作商城 · Duck on Desk',
      frame: true, skipTaskbar: false, focusable: true, minimizable: true, maximizable: true,
      icon: path.join(__dirname, '../../assets/icons/256x256.png'),
      transparent: false, alwaysOnTop: false, resizable: true, backgroundColor: '#0b121d', show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload-market.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    const createdWindow = window;
    // The listing renders third-party text; it must not be able to open windows
    // or navigate itself anywhere, and outbound links go through the IPC above.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== window.webContents.getURL()) event.preventDefault();
    });
    window.once('ready-to-show', () => { if (window === createdWindow) showAndFocus(); });
    window.on('closed', () => { if (window === createdWindow) window = null; });
    if (devUrl) window.loadURL(devUrl);
    else window.loadFile(path.join(__dirname, '../../renderer-dist/market.html'));
  }

  function dispose() {
    if (app.off) app.off('activate', onActivate);
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
  }

  return { open, dispose, isOpen: () => Boolean(window && !window.isDestroyed()) };
}

module.exports = { createMarketWindow, REPO };
