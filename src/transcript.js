// Reads Claude's last reply from a session transcript, for the panel preview.
// Only the tail of the file is read, and results are cached until the file changes.
'use strict';
const fs = require('fs');

const TAIL_BYTES = 256 * 1024;
const MAX_CHARS = 300;
const cache = new Map(); // path -> { size, mtimeMs, text }

function plain(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>|]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastTextIn(transcriptPath, size, tail) {
  const start = Math.max(0, size - tail);
  const fd = fs.openSync(transcriptPath, 'r');
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue;
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    const msg = entry.message;
    if (entry.isSidechain || !msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    const text = plain(msg.content.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join(' '));
    if (text) return text;
  }
  return '';
}

function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  let st;
  try { st = fs.statSync(transcriptPath); } catch { return ''; }
  const hit = cache.get(transcriptPath);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.text;

  let text = '';
  // Long tool output can push Claude's last words further back, so widen once if needed.
  for (const tail of [TAIL_BYTES, TAIL_BYTES * 8]) {
    try { text = lastTextIn(transcriptPath, st.size, tail); } catch {}
    if (text || tail >= st.size) break;
  }
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 1).replace(/\s+\S*$/, '') + '…';
  cache.set(transcriptPath, { size: st.size, mtimeMs: st.mtimeMs, text });
  return text;
}

module.exports = { lastAssistantText };
