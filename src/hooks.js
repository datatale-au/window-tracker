// Adds Window Tracker's hook to ~/.claude/settings.json alongside any hooks already there.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT } = require('./store');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_DEST = path.join(ROOT, 'hook.js');
const MARKER = '.vs-tracker';
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];

// Copies the hook script to a fixed path so settings.json survives extension upgrades.
function deployHookScript(extensionPath) {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.copyFileSync(path.join(extensionPath, 'hooks', 'hook.js'), HOOK_DEST);
}

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
}

function isOurs(group) {
  return (group.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(MARKER));
}

function stripOurs(settings) {
  if (!settings.hooks) return;
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = (settings.hooks[event] || []).filter((g) => !isOurs(g));
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
}

function writeSettings(settings) {
  if (fs.existsSync(SETTINGS)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(SETTINGS, `${SETTINGS}.vs-tracker-backup-${stamp}`);
  }
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
}

function installed() {
  try {
    const hooks = readSettings().hooks || {};
    return EVENTS.every((e) => (hooks[e] || []).some(isOurs));
  } catch {
    return false;
  }
}

function install(extensionPath) {
  deployHookScript(extensionPath);
  const settings = readSettings();
  stripOurs(settings);
  settings.hooks = settings.hooks || {};
  const command = `node "${HOOK_DEST}"`;
  for (const event of EVENTS) {
    settings.hooks[event] = settings.hooks[event] || [];
    settings.hooks[event].push({ hooks: [{ type: 'command', command, timeout: 5 }] });
  }
  writeSettings(settings);
}

function uninstall() {
  const settings = readSettings();
  stripOurs(settings);
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  writeSettings(settings);
}

module.exports = { SETTINGS, deployHookScript, installed, install, uninstall };
