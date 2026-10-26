// Open documents (Power BI Desktop reports, Word, PowerPoint, Excel), listed under the
// VS Code window whose folder holds the file. One window at a time scans
// (scripts/open-docs.ps1) and shares the result in ~/.vs-tracker/docs.json;
// whoever finds the file stale claims it by touching it.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { ROOT, log } = require('./store');

const FILE = path.join(ROOT, 'docs.json');
const APPS = /^"?(PBIDesktop|WINWORD|POWERPNT|EXCEL).exe/im;
const STALE_MS = 12_000;
let scanning = false;

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

function ps(extensionPath, script, args, cb) {
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(extensionPath, 'scripts', script), ...args],
    { windowsHide: true, timeout: 20_000 }, cb);
}

function maybeScan(extensionPath) {
  // VS_TRACKER_DEMO leaves docs.json to whatever wrote it (the demo choreographer).
  if (process.platform !== 'win32' || scanning || process.env.VS_TRACKER_DEMO) return;
  let age = Infinity;
  try { age = Date.now() - fs.statSync(FILE).mtimeMs; } catch {}
  if (age < STALE_MS) return;
  scanning = true;
  try {
    if (fs.existsSync(FILE)) fs.utimesSync(FILE, new Date(), new Date());
    else fs.writeFileSync(FILE, '[]');
  } catch {}
  // tasklist is cheap; skip PowerShell entirely when none of the apps are running.
  execFile('tasklist', ['/NH', '/FO', 'CSV'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
    if (err || !APPS.test(stdout)) {
      write([]);
      scanning = false;
      return;
    }
    ps(extensionPath, 'open-docs.ps1', [], (e, out) => {
      scanning = false;
      if (e) return log(`document scan failed: ${e.message}`);
      try { write([].concat(JSON.parse(out.trim() || '[]'))); } catch (x) { log(`document scan output unreadable: ${x.message}`); }
    });
  });
}

function write(list) {
  const json = JSON.stringify(list);
  try { if (fs.readFileSync(FILE, 'utf8') === json) return fs.utimesSync(FILE, new Date(), new Date()); } catch {}
  fs.writeFileSync(FILE, json);
}

function focus(extensionPath, hwnd) {
  return new Promise((resolve) => {
    ps(extensionPath, 'focus-window.ps1', ['-Hwnd', String(hwnd)], (e, out) => {
      log(`document focus ${hwnd}: ${e ? e.message : out.trim()}`);
      resolve();
    });
  });
}

module.exports = { DOCS_FILE: FILE, read, maybeScan, focus };
