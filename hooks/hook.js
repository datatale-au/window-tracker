#!/usr/bin/env node
// Claude Code hook for Window Tracker. Records each session's state in
// ~/.vs-tracker/sessions/<session_id>.json. Must never block or fail Claude:
// it prints nothing and always exits 0.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SESSIONS = path.join(os.homedir(), '.vs-tracker', 'sessions');
const BACKGROUND_EXPIRE_MS = 12 * 60 * 60_000;

function stateFor(input) {
  switch (input.hook_event_name) {
    case 'SessionStart': return 'idle';
    case 'UserPromptSubmit': return 'working';
    case 'PreToolUse': return input.tool_name === 'AskUserQuestion' ? 'question' : 'working';
    case 'PostToolUse': return 'working';
    case 'Stop': return 'done'; // becomes 'background' if tasks are still running
    case 'Notification': {
      const type = input.notification_type || '';
      if (type === 'permission_prompt') return 'input';
      if (type === 'elicitation_dialog') return 'question';
      if (!type && /permission/i.test(input.message || '')) return 'input';
      return null; // idle_prompt etc. leave the state as it is
    }
    default: return null;
  }
}

function texts(content) {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const b of content) {
    if (b.type === 'text' && b.text) out.push(b.text);
    if (b.type === 'tool_result') out.push(...texts(b.content));
  }
  return out;
}

function questionText(toolInput) {
  const q = toolInput && Array.isArray(toolInput.questions) && toolInput.questions[0];
  if (!q) return 'Claude is asking you a question';
  const options = (q.options || []).map((o) => o.label).filter(Boolean);
  return options.length ? `${q.question} (${options.join(' / ')})` : q.question;
}

function shortName(input) {
  const name = input.description || (input.command || '').split('\n')[0];
  return name.length > 70 ? name.slice(0, 67) + '...' : name;
}

// Reads the transcript from where the last scan stopped and updates the set of
// background tasks (backgrounded Bash commands and async agents) still running.
// They start with a "running in background with ID" / "Async agent launched"
// tool result and end with a <task-notification> or a TaskStop/KillShell call.
// Tasks are stored as { ts, name }; older session files hold a bare timestamp.
function scanBackground(transcriptPath, prev) {
  const tasks = {};
  for (const [id, v] of Object.entries(prev.background || {})) {
    tasks[id] = typeof v === 'number' ? { ts: v, name: 'Background task' } : v;
  }
  const launches = {}; // tool_use id -> name, for Bash/Agent calls seen in this scan
  let offset = prev.scanOffset || 0;
  if (!transcriptPath) return { tasks, offset };

  let size;
  try { size = fs.statSync(transcriptPath).size; } catch { return { tasks, offset }; }
  if (size < offset) offset = 0; // transcript was replaced
  if (size > offset) {
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    const chunk = buf.toString('utf8');
    const end = chunk.lastIndexOf('\n') + 1; // leave a half-written last line for next time
    for (const line of chunk.slice(0, end).split('\n')) {
      if (!/background with ID|Async agent launched|task-notification|"TaskStop"|"KillShell"|"run_in_background"|"name":"Agent"/.test(line)) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const msg = entry.message || {};
      const now = Date.parse(entry.timestamp) || Date.now();
      // Completion notices arrive as queued prompts as well as user messages.
      const candidates = [[entry.content], [entry.attachment && entry.attachment.prompt]];
      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          for (const b of msg.content) {
            if (b.type === 'tool_result') candidates.push([texts(b.content).join('\n'), b.tool_use_id]);
            else if (b.type === 'text') candidates.push([b.text]);
          }
        } else candidates.push([msg.content]);
      }
      for (const [t, toolUseId] of candidates) {
        if (typeof t !== 'string') continue;
        const name = launches[toolUseId] || 'Background task';
        let m;
        if ((m = /^Command running in background with ID: (\w+)/.exec(t))) tasks[m[1]] = { ts: now, name };
        else if (t.startsWith('Async agent launched') && (m = /agentId: (\w+)/.exec(t))) tasks[m[1]] = { ts: now, name };
        else if (t.trimStart().startsWith('<task-notification>')) {
          for (const n of t.matchAll(/<task-id>(\w+)<\/task-id>/g)) delete tasks[n[1]];
        }
      }
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b.type !== 'tool_use' || !b.input) continue;
          if (b.name === 'TaskStop' || b.name === 'KillShell') delete tasks[b.input.task_id || b.input.shell_id];
          else if (b.name === 'Agent' || b.name === 'Task' || (b.name === 'Bash' && b.input.run_in_background)) launches[b.id] = shortName(b.input);
        }
      }
    }
    offset += Buffer.byteLength(chunk.slice(0, end), 'utf8');
  }
  const cutoff = Date.now() - BACKGROUND_EXPIRE_MS;
  for (const [id, t] of Object.entries(tasks)) if (t.ts < cutoff) delete tasks[id];
  return { tasks, offset };
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows refuses the rename while a reader holds the file open.
    fs.writeFileSync(file, data);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function main(raw) {
  const input = JSON.parse(raw);
  if (!input.session_id) return;
  const file = path.join(SESSIONS, `${String(input.session_id).replace(/[^\w.-]/g, '_')}.json`);

  if (input.hook_event_name === 'SessionEnd') {
    try { fs.unlinkSync(file); } catch {}
    return;
  }

  let state = stateFor(input);
  if (!state) return;

  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

  const transcriptPath = input.transcript_path || prev.transcriptPath || '';
  let background = prev.background || {};
  let scanOffset = prev.scanOffset || 0;
  if (input.hook_event_name === 'Stop' || input.hook_event_name === 'SessionStart') {
    ({ tasks: background, offset: scanOffset } = scanBackground(transcriptPath, prev));
    if (state === 'done' && Object.keys(background).length) state = 'background';
  }

  // What Claude is asking, shown in the panel without switching windows.
  let prompt = prev.prompt || '';
  if (input.hook_event_name === 'Notification' && input.message) prompt = input.message;
  else if (input.hook_event_name === 'PreToolUse' && input.tool_name === 'AskUserQuestion') prompt = questionText(input.tool_input);
  else if (state === 'working' || input.hook_event_name === 'Stop') prompt = '';

  const now = Date.now();
  fs.mkdirSync(SESSIONS, { recursive: true });
  writeAtomic(file, JSON.stringify({
    sessionId: input.session_id,
    cwd: input.cwd || prev.cwd || '',
    transcriptPath,
    state,
    since: prev.state === state && prev.since ? prev.since : now,
    seen: prev.state === state ? !!prev.seen : false,
    prompt,
    background,
    scanOffset,
    event: input.hook_event_name,
    ts: now,
  }));
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    try { main(raw); } catch {}
    process.exit(0);
  });
}

module.exports = { scanBackground };
