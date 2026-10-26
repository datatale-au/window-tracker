// Brings another VS Code window to the front by asking the VS Code CLI to open
// its folder: when the folder is already open, VS Code focuses that window.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const vscode = require('vscode');
const { log } = require('./store');

// The CLI is <install>/<exe> run as node on <appRoot>/out/cli.js (what bin/code.cmd does).
function findCli() {
  const cliJs = path.join(vscode.env.appRoot, 'out', 'cli.js');
  if (!fs.existsSync(cliJs)) return null;
  const candidates = [process.execPath];
  for (let dir = vscode.env.appRoot, i = 0; i < 4; i++) {
    dir = path.dirname(dir);
    for (const exe of ['Code.exe', 'Code - Insiders.exe', 'code', 'code-insiders']) {
      candidates.push(path.join(dir, exe));
    }
  }
  const exe = candidates.find((p) => /code/i.test(path.basename(p)) && fs.existsSync(p) && fs.statSync(p).isFile());
  return exe ? { exe, cliJs } : null;
}

async function focusWindow(win) {
  const target = win.workspaceFile || win.folders[0];
  const cli = findCli();
  log(`focus ${win.name} -> ${target} via ${cli ? cli.exe : 'vscode.openFolder'}`);
  if (cli) {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    delete env.VSCODE_DEV;
    const child = spawn(cli.exe, [cli.cliJs, target], { env, detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => { log(`cli error: ${e.message}`); openViaApi(target); });
    child.on('exit', (code) => log(`cli exit ${code}`));
    child.unref();
    return;
  }
  await openViaApi(target);
}

function openViaApi(target) {
  return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), { forceNewWindow: true });
}

// Tiles or stacks the given windows on the current monitor (Windows only).
function arrangeWindows(mode, wins, extensionPath) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('window layouts are only supported on Windows'));
    const names = wins.map((w) => w.name).join('|');
    const script = path.join(extensionPath, 'scripts', 'layout.ps1');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode, '-Names', names],
      { windowsHide: true, timeout: 20_000 }, (err, stdout, stderr) => {
        log(`layout ${mode}: ${(stdout || '').trim()} ${(stderr || '').trim()}`);
        err ? reject(err) : resolve();
      });
  });
}

module.exports = { focusWindow, arrangeWindows };
