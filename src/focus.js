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
    // Drop VS Code's own VSCODE_* variables: inherited IPC handles can point the CLI
    // at a different VS Code instance than the one named by --user-data-dir.
    const env = { ELECTRON_RUN_AS_NODE: '1' };
    for (const [k, v] of Object.entries(process.env)) if (!/^VSCODE_/i.test(k) && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
    // Target the same VS Code instance as the window (it may run with its own --user-data-dir).
    // Options must come before the folder: the CLI ignores them after the first path.
    const args = [cli.cliJs, ...(win.userDataDir ? ['--user-data-dir', win.userDataDir] : []), target];
    log(`cli args: ${args.slice(1).join(' | ')}`);
    const child = spawn(cli.exe, args, { env, detached: true, stdio: 'ignore', windowsHide: true });
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
