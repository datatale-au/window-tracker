// Sidebar panel: this window on top, a thin divider, the other windows, then layout buttons.
// A webview rather than a tree view so it can draw dividers and style the current window.
'use strict';
const crypto = require('crypto');

class Panel {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.view = null;
    this.data = null;
    this.badge = undefined;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html(view.webview.cspSource);
    view.badge = this.badge;
    view.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') this.post();
      else this.onMessage(msg);
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.post(); });
    view.onDidDispose(() => { this.view = null; });
  }

  update(data, badge) {
    this.data = data;
    this.badge = badge;
    if (this.view) this.view.badge = badge;
    this.post();
  }

  post() {
    if (this.view && this.data) this.view.webview.postMessage({ type: 'state', ...this.data });
  }

  visible() {
    return !!(this.view && this.view.visible);
  }
}

function html(cspSource) {
  const nonce = crypto.randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { padding: 4px 0; margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); user-select: none; }
  .row { display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 12px 0 16px; cursor: pointer; white-space: nowrap; border-left: 2px solid transparent; outline: none; }
  .row:hover, .row:focus-visible { background: var(--vscode-list-hoverBackground); }
  .row.self { height: 26px; font-weight: 600; border-left-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground); }
  .row.self:hover { background: var(--vscode-list-inactiveSelectionBackground); }
  .name { overflow: hidden; text-overflow: ellipsis; flex-shrink: 1; min-width: 30px; }
  .desc { color: var(--vscode-descriptionForeground); font-weight: normal; font-size: 0.92em; overflow: hidden; text-overflow: ellipsis; flex-shrink: 100; }
  .tag { font-size: 0.75em; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); border-radius: 8px; padding: 0 6px; line-height: 15px; flex-shrink: 0; }
  .sep { height: 1px; margin: 4px 12px; background: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.35))); }
  .empty { padding: 2px 12px 2px 18px; color: var(--vscode-descriptionForeground); font-style: italic; }
  .action { color: var(--vscode-descriptionForeground); }
  .action:hover { color: var(--vscode-foreground); }

  .icon { width: 14px; height: 14px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 50%; font-size: 10px; font-weight: 700; line-height: 1; }
  .icon.question { background: var(--vscode-charts-purple); color: var(--vscode-editor-background); }
  .icon.input { background: var(--vscode-charts-red); color: var(--vscode-editor-background); }
  .icon.done { color: var(--vscode-charts-green); font-size: 13px; }
  .icon.working { border: 2px solid var(--vscode-charts-blue); border-top-color: transparent; width: 12px; height: 12px; margin: 1px; animation: spin 0.9s linear infinite; }
  .icon.background { border: 2px dotted var(--vscode-charts-orange); width: 12px; height: 12px; margin: 1px; animation: spin 2.4s linear infinite; }
  .icon.idle { border: 1.5px solid var(--vscode-descriptionForeground); width: 10px; height: 10px; margin: 2px; }
  .icon.none { border: 1.5px solid var(--vscode-disabledForeground); width: 10px; height: 10px; margin: 2px; opacity: .6; }
  .icon.layout, .icon.stack { border-radius: 2px; font-size: 13px; font-weight: normal; }

  .row { padding-left: 4px; }
  .chev { width: 12px; flex-shrink: 0; text-align: center; font-size: 10px; color: var(--vscode-descriptionForeground); cursor: pointer; }
  .chev:hover { color: var(--vscode-foreground); }
  .mini { font-size: 0.8em; color: var(--vscode-descriptionForeground); flex-shrink: 0; margin-left: auto; padding-left: 6px; }
  .mini.problem { color: var(--vscode-errorForeground); }
  .details { padding: 0 12px 4px 38px; font-size: 0.92em; }
  .self + .details { background: var(--vscode-list-inactiveSelectionBackground); border-left: 2px solid var(--vscode-focusBorder); padding-left: 36px; }
  .detail { display: flex; gap: 6px; align-items: flex-start; line-height: 18px; color: var(--vscode-descriptionForeground); }
  .detail .dicon { width: 12px; flex-shrink: 0; text-align: center; }
  .detail .text { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .detail .say { white-space: normal; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; font-style: italic; }
  .detail.ask .say { font-style: normal; color: var(--vscode-foreground); }
  .detail.ask .dicon { color: var(--vscode-charts-purple); font-weight: 700; }
  .detail.task .dicon { color: var(--vscode-charts-orange); }
  .detail.link { cursor: pointer; }
  .detail.link:hover { color: var(--vscode-foreground); }
  .detail.problem, .detail.problem:hover { color: var(--vscode-errorForeground); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let state = null;

  const GLYPH = { question: '?', input: '!', done: '\\u2713', layout: '\\u229E', stack: '\\u25A2' };

  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function icon(kind) {
    return el('span', 'icon ' + kind, GLYPH[kind] || '');
  }

  function clickable(row, msg) {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.addEventListener('click', () => vscode.postMessage(msg));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vscode.postMessage(msg); } });
  }

  // Expanded/collapsed choices per window id, kept across panel reloads.
  const saved = vscode.getState() || {};
  const expanded = saved.expanded || {};

  const KIND = { pbi: 'Power BI', word: 'Word', powerpoint: 'PowerPoint', excel: 'Excel' };

  function needsLook(w) {
    return !!w.prompt || w.docs.some((d) => d.problem);
  }

  function isOpen(w) {
    return w.id in expanded ? expanded[w.id] : needsLook(w);
  }

  function detail(cls, glyph, text, textCls) {
    const d = el('div', 'detail ' + cls);
    d.append(el('span', 'dicon', glyph), el('span', 'text ' + (textCls || ''), text));
    return d;
  }

  function details(w) {
    const box = el('div', 'details');
    if (w.prompt) box.append(detail('ask', '?', w.prompt, 'say'));
    else if (w.lastText) box.append(detail('said', '\\u201C', w.lastText, 'say'));
    for (const t of w.tasks) box.append(detail('task', '\\u25CC', t.name + ' \\u00B7 ' + ago(t.ts)));
    for (const doc of w.docs) {
      const kind = KIND[doc.kind] || doc.kind;
      const d = detail('link' + (doc.problem ? ' problem' : ''), doc.problem ? '\\u26A0' : '\\u25A4', kind + ': ' + doc.name + (doc.problem ? ' \\u2014 ' + doc.problem : ''));
      d.title = 'Bring this ' + kind + ' window to the front';
      clickable(d, { type: 'focusDoc', hwnd: doc.hwnd });
      box.append(d);
    }
    return box;
  }

  function windowRow(w, self) {
    const hasDetails = !!(w.prompt || w.lastText || w.tasks.length || w.docs.length);
    const open = hasDetails && isOpen(w);
    const row = el('div', 'row' + (self ? ' self' : ''));
    row.title = w.name + '\\n' + w.label + (w.prompt || w.lastText ? '\\n\\n' + (w.prompt || w.lastText) : '') +
      '\\n\\n' + w.folders.join('\\n') + (w.sessions > 1 ? '\\n' + w.sessions + ' Claude sessions' : '');

    const chev = el('span', 'chev', hasDetails ? (open ? '\\u25BE' : '\\u25B8') : '');
    if (hasDetails) {
      chev.title = open ? 'Hide details' : 'Show details';
      chev.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded[w.id] = !open;
        vscode.setState({ expanded });
        render();
      });
    }
    row.append(chev, icon(w.state), el('span', 'name', w.name));
    if (self) row.append(el('span', 'tag', 'this window'));
    row.append(el('span', 'desc', w.label + (w.state === 'none' ? '' : ' \\u00B7 ' + ago(w.since))));
    if (!open && w.docs.length) {
      const bad = w.docs.some((d) => d.problem);
      const mini = el('span', 'mini' + (bad ? ' problem' : ''), (bad ? '\\u26A0' : '\\u25A4') + ' ' + w.docs.length);
      mini.title = w.docs.map((d) => (KIND[d.kind] || d.kind) + ': ' + d.name + (d.problem ? ' (' + d.problem + ')' : '')).join('\\n');
      row.append(mini);
    }
    clickable(row, { type: 'focus', id: w.id });

    const frag = document.createDocumentFragment();
    frag.append(row);
    if (open) frag.append(details(w));
    return frag;
  }

  function actionRow(kind, label, tip) {
    const row = el('div', 'row action');
    row.title = tip;
    row.append(el('span', 'chev'), icon(kind), el('span', 'name', label));
    clickable(row, { type: kind === 'layout' ? 'tile' : 'stack' });
    return row;
  }

  function render() {
    if (!state) return;
    root.replaceChildren();
    if (state.self) root.append(windowRow(state.self, true));
    else root.append(el('div', 'empty', 'Open a folder in this window to track it.'));
    root.append(el('div', 'sep'));
    if (state.others.length) state.others.forEach((w) => root.append(windowRow(w, false)));
    else root.append(el('div', 'empty', 'No other VS Code windows open.'));
    if (state.others.length) {
      root.append(el('div', 'sep'));
      root.append(actionRow('layout', 'Tile all on this screen', 'Arrange every window in a grid on the monitor this window is on'));
      root.append(actionRow('stack', 'Stack all on this screen', 'Maximise every window on this monitor; switch between them from the list'));
    }
  }

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') { state = e.data; render(); }
  });
  setInterval(render, 5000);
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

module.exports = { Panel };
