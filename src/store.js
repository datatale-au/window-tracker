// Shared state on disk. Every VS Code window reads and writes ~/.vs-tracker:
//   windows/<vscode sessionId>.json  one per open window, refreshed by a heartbeat
//   sessions/<claude session_id>.json  one per Claude session, written by hooks/hook.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(os.homedir(), '.vs-tracker');
const WINDOWS = path.join(ROOT, 'windows');
const SESSIONS = path.join(ROOT, 'sessions');

const HEARTBEAT_MS = 15_000;
const WINDOW_DEAD_MS = 45_000;
const WINDOW_PURGE_MS = 10 * 60_000;
const SESSION_PURGE_MS = 24 * 60 * 60_000;

// Highest first: the state a window shows when it has several Claude sessions.
const PRIORITY = ['question', 'input', 'done', 'working', 'background', 'idle', 'none'];

function ensureDirs() {
  fs.mkdirSync(WINDOWS, { recursive: true });
  fs.mkdirSync(SESSIONS, { recursive: true });
}

function readJsonDir(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try { out.push({ file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }); } catch {}
  }
  return out;
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, JSON.stringify(data));
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Appends to ~/.vs-tracker/log.txt, trimmed so it never grows large.
function log(msg) {
  const file = path.join(ROOT, 'log.txt');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 200_000) fs.unlinkSync(file);
    fs.appendFileSync(file, `${new Date().toISOString()} [${process.pid}] ${msg}\n`);
  } catch {}
}

function norm(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function isInside(child, parent) {
  return child === parent || child.startsWith(parent + path.sep);
}

function windowFile(id) {
  return path.join(WINDOWS, `${id.replace(/[^\w.-]/g, '_')}.json`);
}

function writeWindow(info) {
  writeJson(windowFile(info.id), { ...info, lastSeen: Date.now() });
}

function removeWindow(id) {
  try { fs.unlinkSync(windowFile(id)); } catch {}
}

// Returns live windows, each with its matching Claude sessions, open
// documents (from docs.js) and overall state.
function snapshot(docList = []) {
  const now = Date.now();

  const windows = [];
  for (const { file, data } of readJsonDir(WINDOWS)) {
    const age = now - (data.lastSeen || 0);
    if (age > WINDOW_PURGE_MS) { try { fs.unlinkSync(file); } catch {} continue; }
    if (age > WINDOW_DEAD_MS || !data.folders || !data.folders.length) continue;
    windows.push({ ...data, normFolders: data.folders.map(norm), sessions: [] });
  }

  // The window whose folder is the closest parent of a path.
  function owner(p) {
    const target = norm(p);
    let best = null;
    let bestLen = -1;
    for (const w of windows) {
      for (const f of w.normFolders) {
        if (isInside(target, f) && f.length > bestLen) { best = w; bestLen = f.length; }
      }
    }
    return best;
  }

  for (const { file, data } of readJsonDir(SESSIONS)) {
    if (now - (data.ts || 0) > SESSION_PURGE_MS) { try { fs.unlinkSync(file); } catch {} continue; }
    if (!data.cwd) continue;
    const w = owner(data.cwd);
    if (w) w.sessions.push({ ...data, file });
  }

  for (const w of windows) w.docs = [];
  for (const d of docList) {
    const w = d.path && owner(d.path);
    if (w) w.docs.push(d);
  }

  for (const w of windows) {
    w.state = 'none';
    w.since = w.lastSeen;
    for (const s of w.sessions) {
      const st = s.state === 'done' && s.seen ? 'idle' : s.state;
      if (PRIORITY.indexOf(st) < PRIORITY.indexOf(w.state)) { w.state = st; w.since = s.since; }
    }
  }

  windows.sort((a, b) =>
    PRIORITY.indexOf(a.state) - PRIORITY.indexOf(b.state) ||
    a.name.localeCompare(b.name));
  return windows;
}

// Marks this window's finished sessions as seen, so they stop counting as waiting.
function markSeen(win) {
  for (const s of win.sessions) {
    if (s.state !== 'done' || s.seen) continue;
    const { file, ...data } = s;
    try { writeJson(file, { ...data, seen: true }); } catch {}
  }
}

module.exports = {
  ROOT, WINDOWS, SESSIONS, HEARTBEAT_MS,
  ensureDirs, log, writeWindow, removeWindow, snapshot, markSeen,
};
