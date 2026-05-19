const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'OPEN MIX',
    backgroundColor: '#F2EFE7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('show-open-dialog', async (_event, options) => {
  if (!mainWindow) return { canceled: true };
  return await dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('show-save-dialog', async (_event, options) => {
  if (!mainWindow) return { canceled: true };
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('read-file', async (_event, filePath) => {
  const data = await fs.readFile(filePath);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
});

ipcMain.handle('write-file', async (_event, filePath, data) => {
  let buf;
  if (typeof data === 'string') {
    buf = Buffer.from(data, 'utf8');
  } else if (data instanceof Uint8Array) {
    buf = Buffer.from(data);
  } else if (data instanceof ArrayBuffer) {
    buf = Buffer.from(data);
  } else {
    buf = Buffer.from(data);
  }
  await fs.writeFile(filePath, buf);
  return true;
});
