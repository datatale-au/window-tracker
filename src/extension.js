'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const store = require('./store');
const hooks = require('./hooks');
const { focusWindow, arrangeWindows } = require('./focus');
const { Panel } = require('./panel');
const docs = require('./docs');
const { lastAssistantText } = require('./transcript');

const FOCUS_REQUEST = path.join(store.ROOT, 'focus-request.json');

const STATES = {
  question: { label: 'Asking you a question', waiting: true },
  input: { label: 'Needs your input', waiting: true },
  done: { label: 'Done, your turn', waiting: true },
  working: { label: 'Working', waiting: false },
  background: { label: 'Running in background', waiting: false },
  idle: { label: 'Idle', waiting: false },
  none: { label: 'No Claude session', waiting: false },
};

function toRow(w) {
  const tasks = [];
  for (const s of w.sessions) {
    for (const t of Object.values(s.background || {})) tasks.push(typeof t === 'number' ? { ts: t, name: 'Background task' } : t);
  }
  tasks.sort((a, b) => a.ts - b.ts);
  const label = w.state === 'background' ? `Running in background (${tasks.length} task${tasks.length === 1 ? '' : 's'})` : STATES[w.state].label;
  // A pending question speaks for the window; otherwise the most recent session's last reply.
  const asking = w.sessions.find((s) => (s.state === 'question' || s.state === 'input') && s.prompt);
  const latest = [...w.sessions].sort((a, b) => b.ts - a.ts)[0];
  return {
    id: w.id, name: w.name, state: w.state, label, since: w.since, folders: w.folders, sessions: w.sessions.length,
    prompt: asking ? asking.prompt : '',
    lastText: latest ? lastAssistantText(latest.transcriptPath) : '',
    tasks,
    docs: w.docs.map((d) => ({ kind: d.kind, hwnd: d.hwnd, name: d.name, problem: d.problem })),
  };
}

function activate(context) {
  store.ensureDirs();
  store.log(`activate ${vscode.workspace.name} execPath=${process.execPath} appRoot=${vscode.env.appRoot}`);
  try { hooks.deployHookScript(context.extensionPath); } catch {}

  const selfId = vscode.env.sessionId;
  const panel = new Panel((msg) => {
    if (msg.type === 'focus') vscode.commands.executeCommand('vsTracker.focus', msg.id);
    else if (msg.type === 'tile') arrange('tile');
    else if (msg.type === 'stack') arrange('stack');
    else if (msg.type === 'focusDoc') docs.focus(context.extensionPath, msg.hwnd);
  });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  status.command = 'vsTracker.focusNext';
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('vsTracker.panel', panel), status);

  let windows = [];
  let lastStates = new Map();
  let lastDocProblems = new Map();

  // Brings a window forward and, if enabled, asks it to put the cursor in Claude's input.
  async function goTo(w) {
    await focusWindow(w);
    if (vscode.workspace.getConfiguration('vsTracker').get('focusClaudeInput')) {
      try { fs.writeFileSync(FOCUS_REQUEST, JSON.stringify({ id: w.id, ts: Date.now() })); } catch {}
    }
  }

  function focusClaude() {
    vscode.commands.executeCommand('claude-vscode.focus').then(undefined, (e) => store.log(`claude focus failed: ${e.message}`));
  }

  function handleFocusRequest() {
    let req;
    try { req = JSON.parse(fs.readFileSync(FOCUS_REQUEST, 'utf8')); } catch { return; }
    if (req.id !== selfId || Date.now() - req.ts > 5000) return;
    try { fs.unlinkSync(FOCUS_REQUEST); } catch { return; } // another event already took it
    setTimeout(focusClaude, 300); // let the window finish coming forward
  }

  function heartbeat() {
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    if (!folders.length) return store.removeWindow(selfId);
    const ws = vscode.workspace.workspaceFile;
    store.writeWindow({
      id: selfId,
      name: vscode.workspace.name || folders[0],
      folders,
      workspaceFile: ws && ws.scheme === 'file' ? ws.fsPath : null,
      pid: process.pid,
    });
  }

  function others() {
    return windows.filter((w) => w.id !== selfId);
  }

  function refresh() {
    windows = store.snapshot(docs.read());
    const waiting = others().filter((w) => STATES[w.state].waiting);
    const self = windows.find((w) => w.id === selfId);
    panel.update(
      { self: self ? toRow(self) : null, others: others().map(toRow) },
      waiting.length ? { value: waiting.length, tooltip: `${waiting.length} window(s) waiting on you` } : undefined);
    if (waiting.length) {
      status.text = `$(bell) ${waiting.length} waiting`;
      status.tooltip = waiting.map((w) => `${w.name}: ${STATES[w.state].label}`).join('\n');
      status.show();
    } else {
      status.hide();
    }

    notify();
    if (self && vscode.window.state.focused) store.markSeen(self);
  }

  // Pop-up in the focused window only, so four windows don't all toast at once.
  function notify() {
    const next = new Map(windows.map((w) => [w.id, w.state]));
    const fresh = others().filter((w) =>
      lastStates.has(w.id) && lastStates.get(w.id) !== w.state &&
      (w.state === 'question' || w.state === 'input' || (w.state === 'done' && lastStates.get(w.id) === 'background')));
    lastStates = next;

    const problems = new Map();
    const stuck = [];
    for (const w of windows) {
      for (const d of w.docs) {
        if (!d.problem) continue;
        problems.set(d.hwnd, d.problem);
        if (lastDocProblems.get(d.hwnd) !== d.problem) stuck.push({ w, d });
      }
    }
    lastDocProblems = problems;

    if (!vscode.window.state.focused) return;
    if (!vscode.workspace.getConfiguration('vsTracker').get('notify')) return;
    for (const w of fresh) {
      const text = w.state === 'done' ? 'Background work finished' : STATES[w.state].label;
      vscode.window.showInformationMessage(`${w.name}: ${text}`, 'Go there').then((pick) => {
        if (pick) goTo(w);
      });
    }
    for (const { w, d } of stuck) {
      vscode.window.showWarningMessage(`${w.name}: "${d.name}" - ${d.problem}`, 'Show it').then((pick) => {
        if (pick) docs.focus(context.extensionPath, d.hwnd);
      });
    }
  }

  // Grid order is by name so windows keep their place; when stacking, this
  // window goes last so it ends up on top.
  async function arrange(mode) {
    const byName = [...windows].sort((a, b) => a.name.localeCompare(b.name));
    const order = mode === 'tile' ? byName : [...byName.filter((w) => w.id !== selfId), ...byName.filter((w) => w.id === selfId)];
    try {
      await arrangeWindows(mode, order, context.extensionPath);
      context.globalState.update('vsTracker.layout', mode);
      const self = windows.find((w) => w.id === selfId);
      if (self) focusWindow(self);
    } catch (e) {
      vscode.window.showErrorMessage(`Window Tracker could not arrange windows: ${e.message}`);
    }
  }

  let timer = null;
  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  }

  try {
    const watcher = fs.watch(store.ROOT, (_, name) => {
      if (name === path.basename(docs.DOCS_FILE)) scheduleRefresh();
      else if (name === path.basename(FOCUS_REQUEST)) handleFocusRequest();
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {}

  for (const dir of [store.WINDOWS, store.SESSIONS]) {
    try {
      const watcher = fs.watch(dir, scheduleRefresh);
      context.subscriptions.push({ dispose: () => watcher.close() });
    } catch {}
  }

  heartbeat();
  refresh();
  const beat = setInterval(heartbeat, store.HEARTBEAT_MS);
  docs.maybeScan(context.extensionPath);
  const tick = setInterval(() => { refresh(); docs.maybeScan(context.extensionPath); }, 5_000); // ages, stale windows, documents
  context.subscriptions.push(
    { dispose: () => { clearInterval(beat); clearInterval(tick); clearTimeout(timer); } },
    vscode.workspace.onDidChangeWorkspaceFolders(heartbeat),
    vscode.window.onDidChangeWindowState((s) => { if (s.focused) refresh(); }),

    vscode.commands.registerCommand('vsTracker.focus', async (id) => {
      const w = windows.find((x) => x.id === id);
      store.log(`click ${id} found=${!!w} self=${id === selfId}`);
      if (w && w.id === selfId) return focusClaude();
      if (!w) return;
      try {
        await goTo(w);
      } catch (e) {
        store.log(`focus failed: ${e.stack || e}`);
        vscode.window.showErrorMessage(`Window Tracker could not switch to ${w.name}: ${e.message}`);
      }
    }),
    vscode.commands.registerCommand('vsTracker.focusNext', () => {
      const w = others().find((x) => STATES[x.state].waiting);
      if (w) goTo(w);
    }),
    vscode.commands.registerCommand('vsTracker.refresh', () => { heartbeat(); refresh(); }),
    vscode.commands.registerCommand('vsTracker.tile', () => arrange('tile')),
    vscode.commands.registerCommand('vsTracker.stack', () => arrange('stack')),
    vscode.commands.registerCommand('vsTracker.toggleLayout', () =>
      arrange(context.globalState.get('vsTracker.layout') === 'tile' ? 'stack' : 'tile')),
    vscode.commands.registerCommand('vsTracker.installHooks', () => {
      try {
        hooks.install(context.extensionPath);
        vscode.window.showInformationMessage('Window Tracker hooks added to ~/.claude/settings.json (backup saved next to it). New Claude sessions will report their status.');
      } catch (e) {
        vscode.window.showErrorMessage(`Window Tracker could not update ${hooks.SETTINGS}: ${e.message}`);
      }
    }),
    vscode.commands.registerCommand('vsTracker.uninstallHooks', () => {
      try {
        hooks.uninstall();
        vscode.window.showInformationMessage('Window Tracker hooks removed from ~/.claude/settings.json.');
      } catch (e) {
        vscode.window.showErrorMessage(`Window Tracker could not update ${hooks.SETTINGS}: ${e.message}`);
      }
    }),
  );

  if (!hooks.installed()) {
    vscode.window.showInformationMessage(
      'Window Tracker needs Claude Code hooks to see session status. Add them to ~/.claude/settings.json?',
      'Install hooks').then((pick) => {
      if (pick) vscode.commands.executeCommand('vsTracker.installHooks');
    });
  }

  context.subscriptions.push({ dispose: () => store.removeWindow(selfId) });
}

function deactivate() {}

module.exports = { activate, deactivate };
