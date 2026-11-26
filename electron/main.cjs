const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const APP_NAME = 'IJP Patterner';
const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const isMac = process.platform === 'darwin';

app.setName(APP_NAME);

/** @type {BrowserWindow | null} */
let win = null;
let dirty = false;
let quitAfterSave = false;
let forceClose = false;
let pendingOpenPath = process.argv.slice(1).find((a) => /\.ptn$/i.test(a) && !a.startsWith('-')) || null;

const FILTERS = [
  { name: 'Pattern file', extensions: ['ptn'] },
  { name: 'XML', extensions: ['xml'] },
];

const libraryDir = () => path.join(app.getPath('userData'), 'library');

async function ensureLibrary() {
  const dir = libraryDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const safeName = (name) =>
  String(name || 'pattern')
    .replace(/[^\w .+-]/g, '_')
    .replace(/\.ptn$/i, '')
    .slice(0, 80) || 'pattern';

async function readPattern(filePath) {
  const xml = await fs.readFile(filePath, 'utf8');
  return {
    path: filePath,
    name: path.basename(filePath),
    dir: path.dirname(filePath),
    xml,
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function buildMenu() {
  const menu = Menu.buildFromTemplate([
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Pattern', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        { label: 'Import SVG…', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('menu', 'import-svg') },
        { label: 'Pattern Library…', accelerator: 'CmdOrCtrl+L', click: () => send('menu', 'library') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'save-as') },
        { type: 'separator' },
        { label: 'Export Preview as SVG…', click: () => send('menu', 'export-svg') },
        { label: 'Export Preview as PNG…', click: () => send('menu', 'export-png') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu', 'undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('menu', 'redo') },
        { type: 'separator' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: () => send('menu', 'duplicate') },
        { label: 'Delete Selected', click: () => send('menu', 'delete') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => send('menu', 'cut') },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => send('menu', 'copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => send('menu', 'paste') },
        { label: 'Paste in Place', accelerator: 'CmdOrCtrl+Shift+V', click: () => send('menu', 'paste-in-place') },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => send('menu', 'zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('menu', 'zoom-out') },
        { label: 'Fit Pattern', accelerator: 'CmdOrCtrl+0', click: () => send('menu', 'fit') },
        { type: 'separator' },
        { label: 'Toggle Print Raster', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('menu', 'toggle-raster') },
        { label: 'Toggle Grid', accelerator: 'CmdOrCtrl+G', click: () => send('menu', 'toggle-grid') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        { label: 'Pattern Format Reference', click: () => send('menu', 'help') },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0b1015',
    show: false,
    title: APP_NAME,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.once('ready-to-show', () => win.show());

  win.webContents.once('did-finish-load', () => {
    if (pendingOpenPath) {
      send('open-path', pendingOpenPath);
      pendingOpenPath = null;
    }
  });

  win.on('close', (event) => {
    if (forceClose || !dirty) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save and quit', 'Quit without saving', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'This pattern has unsaved changes.',
      detail: 'Save the pattern before closing?',
    });
    if (choice === 0) {
      quitAfterSave = true;
      send('menu', 'save-and-quit');
    } else if (choice === 1) {
      forceClose = true;
      win.close();
    }
  });

  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const ok = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!ok) event.preventDefault();
  });
}

/* ------------------------------------------------------------------ IPC --- */

ipcMain.handle('file:open-dialog', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open pattern',
    properties: ['openFile', 'multiSelections'],
    filters: FILTERS,
  });
  if (res.canceled || res.filePaths.length === 0) return { canceled: true };
  try {
    const files = await Promise.all(res.filePaths.map(readPattern));
    return { canceled: false, files };
  } catch (err) {
    return { canceled: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('file:read', async (_e, filePath) => {
  try {
    return await readPattern(filePath);
  } catch (err) {
    return { error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('file:save', async (_e, { path: target, xml, defaultName, filters }) => {
  let filePath = target;
  if (!filePath) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Save pattern',
      defaultPath: path.join(app.getPath('documents'), defaultName || 'pattern.ptn'),
      filters: filters || FILTERS,
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    filePath = res.filePath;
  }
  try {
    await fs.writeFile(filePath, xml, 'utf8');
    if (isMac) app.addRecentDocument(filePath);
    return { canceled: false, path: filePath, name: path.basename(filePath), dir: path.dirname(filePath) };
  } catch (err) {
    return { canceled: false, error: String(err && err.message ? err.message : err) };
  }
});

/* ----------------------------------------------------------- clipboard --- */

ipcMain.handle('clip:write', (_e, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});

ipcMain.handle('clip:read', () => clipboard.readText());

/* ------------------------------------------------------------- library --- */

ipcMain.handle('lib:list', async () => {
  const dir = await ensureLibrary();
  try {
    const names = await fs.readdir(dir);
    const entries = [];
    for (const n of names) {
      if (!/\.ptn$/i.test(n)) continue;
      const st = await fs.stat(path.join(dir, n));
      entries.push({ name: n.replace(/\.ptn$/i, ''), file: n, mtime: st.mtimeMs, size: st.size });
    }
    entries.sort((a, b) => b.mtime - a.mtime);
    return { dir, entries };
  } catch (err) {
    return { dir, entries: [], error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('lib:save', async (_e, { name, xml }) => {
  const dir = await ensureLibrary();
  const file = `${safeName(name)}.ptn`;
  try {
    await fs.writeFile(path.join(dir, file), xml, 'utf8');
    return { ok: true, name: file.replace(/\.ptn$/i, ''), file, dir };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('lib:read', async (_e, name) => {
  const dir = await ensureLibrary();
  try {
    const xml = await fs.readFile(path.join(dir, `${safeName(name)}.ptn`), 'utf8');
    return { ok: true, xml, name: safeName(name) };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('lib:delete', async (_e, name) => {
  const dir = await ensureLibrary();
  try {
    await fs.unlink(path.join(dir, `${safeName(name)}.ptn`));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('lib:copy', async (_e, { names, dir: targetDir }) => {
  let dest = targetDir;
  if (!dest) {
    const res = await dialog.showOpenDialog(win, {
      title: 'Copy patterns to folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    dest = res.filePaths[0];
  }
  const src = await ensureLibrary();
  const copied = [];
  const failed = [];
  for (const n of names) {
    const file = `${safeName(n)}.ptn`;
    try {
      await fs.copyFile(path.join(src, file), path.join(dest, file));
      copied.push(file);
    } catch (err) {
      failed.push(`${file}: ${err && err.message ? err.message : err}`);
    }
  }
  return { canceled: false, dir: dest, copied, failed };
});

ipcMain.handle('lib:reveal', async () => {
  const dir = await ensureLibrary();
  await shell.openPath(dir);
  return { dir };
});

ipcMain.handle('file:open-svg', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import SVG',
    properties: ['openFile'],
    filters: [{ name: 'SVG', extensions: ['svg'] }],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  try {
    const svg = await fs.readFile(res.filePaths[0], 'utf8');
    return { canceled: false, path: res.filePaths[0], name: path.basename(res.filePaths[0]), svg };
  } catch (err) {
    return { canceled: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('file:choose-directory', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  return { canceled: false, dir: res.filePaths[0] };
});

ipcMain.handle('file:export', async (_e, { data, defaultName, filters, binary }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: path.join(app.getPath('desktop'), defaultName || 'pattern.svg'),
    filters,
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  try {
    if (binary) {
      await fs.writeFile(res.filePath, Buffer.from(data, 'base64'));
    } else {
      await fs.writeFile(res.filePath, data, 'utf8');
    }
    return { canceled: false, path: res.filePath };
  } catch (err) {
    return { canceled: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.on('window:dirty', (_e, value) => {
  dirty = Boolean(value);
  if (isMac && win && !win.isDestroyed()) win.setDocumentEdited(dirty);
});

ipcMain.on('window:title', (_e, title) => {
  if (win && !win.isDestroyed()) win.setTitle(title ? titler(title) : APP_NAME);
});

function titler(name) {
  return isMac ? name : `${name} — ${APP_NAME}`;
}

ipcMain.on('app:quit-now', () => {
  forceClose = true;
  if (quitAfterSave && win) win.close();
  else if (quitAfterSave) app.quit();
});

ipcMain.on('app:cancel-quit', () => {
  quitAfterSave = false;
});

/* -------------------------------------------------------------- startup --- */

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// double-clicking a .ptn in Finder
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (win && !win.isDestroyed()) {
    send('open-path', filePath);
    win.focus();
  } else {
    pendingOpenPath = filePath;
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
