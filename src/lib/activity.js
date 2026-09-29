'use strict';
const crypto = require('crypto');
const store = require('./store');

const MAX_ENTRIES = 300;

const ICONS = {
  login: '🔑',
  login_failed: '⚠️',
  user_create: '➕',
  user_update: '✏️',
  user_delete: '🗑️',
  user_toggle: '🔁',
  user_regenerate: '♻️',
  user_reset_traffic: '📉',
  group_create: '📦',
  group_update: '✏️',
  group_delete: '🗑️',
  settings_update: '⚙️',
  admin_create: '👤',
  admin_delete: '🚫',
  backup_restore: '📥',
  xray_restart: '🔄'
};

function log(actor, action, detail) {
  const state = store.getState();
  state.activity.unshift({
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    actor: actor || 'system',
    action,
    detail: detail || ''
  });
  if (state.activity.length > MAX_ENTRIES) state.activity.length = MAX_ENTRIES;
  store.persist();
}

function iconFor(action) {
  return ICONS[action] || '•';
}

module.exports = { log, iconFor };
