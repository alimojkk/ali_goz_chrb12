'use strict';
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const store = require('../lib/store');
const { requireAuth, requireOwner, verifyPassword, hashPassword } = require('../lib/auth');
const xray = require('../lib/xray');
const activity = require('../lib/activity');
const sysstats = require('../lib/sysstats');

router.use(requireAuth);
router.use(express.json({ limit: '5mb' }));

function genUUID() {
  return crypto.randomUUID();
}
function genToken() {
  return crypto.randomBytes(16).toString('hex');
}
function actorName(req) {
  return (req.admin && req.admin.u) || 'admin';
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;

// ---------- Users ----------

router.get('/users', (req, res) => {
  const state = store.getState();
  res.json(state.users);
});

router.post('/users', (req, res) => {
  const state = store.getState();
  const { username, trafficLimitGB, expiresAt, note, protocols, telegramId, expireStrategy, expireDays } = req.body;
  const name = (username || '').trim();
  if (!name || !USERNAME_RE.test(name)) {
    return res
      .status(400)
      .json({ error: 'نام کاربری باید ۳ تا ۳۲ کاراکتر و فقط شامل حروف انگلیسی، عدد، خط تیره یا زیرخط باشد.' });
  }
  if (state.users.some((u) => u.username === name)) {
    return res.status(400).json({ error: 'این نام کاربری قبلاً استفاده شده است.' });
  }
  const strategy = expireStrategy === 'first_use' ? 'first_use' : 'fixed';
  const user = {
    id: crypto.randomUUID(),
    username: name,
    uuid: genUUID(),
    enabled: true,
    protocols: {
      vless: !protocols || protocols.vless !== false,
      vmess: !protocols || protocols.vmess !== false,
      trojan: !protocols || protocols.trojan !== false
    },
    trafficLimitGB: Number(trafficLimitGB) || 0,
    trafficUsedBytes: 0,
    expiresAt: strategy === 'fixed' ? expiresAt || null : null,
    expireStrategy: strategy,
    expireDays: strategy === 'first_use' ? Number(expireDays) || 30 : null,
    firstConnectedAt: null,
    note: note || '',
    telegramId: telegramId || '',
    groupIds: [],
    subToken: genToken(),
    createdAt: new Date().toISOString()
  };
  state.users.push(user);
  store.persist();
  xray.restart();
  activity.log(actorName(req), 'user_create', `کاربر «${user.username}» ساخته شد`);
  res.json(user);
});

// ساخت سریع یک کاربر با تنظیمات پیش‌فرض (بدون فرم) — دکمه «کاربر سریع»
router.post('/users/quick', (req, res) => {
  const state = store.getState();
  let n = state.users.length + 1;
  let name = `user${n}`;
  while (state.users.some((u) => u.username === name)) {
    n++;
    name = `user${n}`;
  }
  const user = {
    id: crypto.randomUUID(),
    username: name,
    uuid: genUUID(),
    enabled: true,
    protocols: { vless: true, vmess: true, trojan: true },
    trafficLimitGB: 0,
    trafficUsedBytes: 0,
    expiresAt: null,
    expireStrategy: 'fixed',
    expireDays: null,
    firstConnectedAt: null,
    note: '',
    telegramId: '',
    groupIds: [],
    subToken: genToken(),
    createdAt: new Date().toISOString()
  };
  state.users.push(user);
  store.persist();
  xray.restart();
  activity.log(actorName(req), 'user_create', `کاربر سریع «${user.username}» ساخته شد`);
  res.json(user);
});

router.put('/users/:id', (req, res) => {
  const state = store.getState();
  const user = state.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد.' });
  const { trafficLimitGB, expiresAt, note, protocols, enabled, username, telegramId, expireStrategy, expireDays } = req.body;

  if (username && username.trim() !== user.username) {
    const name = username.trim();
    if (!USERNAME_RE.test(name)) {
      return res.status(400).json({ error: 'نام کاربری نامعتبر است.' });
    }
    if (state.users.some((u) => u.username === name && u.id !== user.id)) {
      return res.status(400).json({ error: 'این نام کاربری قبلاً استفاده شده است.' });
    }
    user.username = name;
  }
  if (trafficLimitGB !== undefined) user.trafficLimitGB = Number(trafficLimitGB) || 0;
  if (note !== undefined) user.note = note;
  if (telegramId !== undefined) user.telegramId = telegramId;
  if (enabled !== undefined) user.enabled = !!enabled;
  if (protocols !== undefined) {
    user.protocols = {
      vless: protocols.vless !== false,
      vmess: protocols.vmess !== false,
      trojan: protocols.trojan !== false
    };
  }
  if (expireStrategy !== undefined) {
    user.expireStrategy = expireStrategy === 'first_use' ? 'first_use' : 'fixed';
    if (user.expireStrategy === 'fixed') {
      user.expireDays = null;
      if (expiresAt !== undefined) user.expiresAt = expiresAt || null;
    } else {
      user.expireDays = Number(expireDays) || user.expireDays || 30;
      // اگر قبلاً استفاده نشده، انقضا هنوز محاسبه نمی‌شود
      if (!user.firstConnectedAt) user.expiresAt = null;
    }
  } else if (expiresAt !== undefined && user.expireStrategy !== 'first_use') {
    user.expiresAt = expiresAt || null;
  }

  store.persist();
  xray.restart();
  activity.log(actorName(req), 'user_update', `کاربر «${user.username}» ویرایش شد`);
  res.json(user);
});

router.post('/users/:id/reset-traffic', (req, res) => {
  const state = store.getState();
  const user = state.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد.' });
  user.trafficUsedBytes = 0;
  store.persist();
  xray.restart();
  activity.log(actorName(req), 'user_reset_traffic', `مصرف کاربر «${user.username}» صفر شد`);
  res.json(user);
});

router.post('/users/:id/toggle', (req, res) => {
  const state = store.getState();
  const user = state.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد.' });
  user.enabled = !user.enabled;
  store.persist();
  xray.restart();
  activity.log(actorName(req), 'user_toggle', `کاربر «${user.username}» ${user.enabled ? 'فعال' : 'غیرفعال'} شد`);
  res.json(user);
});

router.post('/users/:id/regenerate', (req, res) => {
  const state = store.getState();
  const user = state.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد.' });
  user.uuid = genUUID();
  user.subToken = genToken();
  store.persist();
  xray.restart();
  activity.log(actorName(req), 'user_regenerate', `لینک‌های کاربر «${user.username}» بازسازی شد`);
  res.json(user);
});

router.delete('/users/:id', (req, res) => {
  const state = store.getState();
  const idx = state.users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'کاربر پیدا نشد.' });
  const name = state.users[idx].username;
  state.users.splice(idx, 1);
  for (const g of state.groups) {
    g.userIds = g.userIds.filter((id) => id !== req.params.id);
  }
  store.persist();
  xray.restart();
  activity.log(actorName(req), 'user_delete', `کاربر «${name}» حذف شد`);
  res.json({ ok: true });
});

// ---------- Groups (سابسکریپشن‌های گروهی) ----------

router.get('/groups', (req, res) => {
  res.json(store.getState().groups);
});

router.post('/groups', (req, res) => {
  const state = store.getState();
  const name = (req.body.name || '').trim();
  if (!name || name.length < 2) return res.status(400).json({ error: 'نام گروه باید حداقل ۲ کاراکتر باشد.' });
  const userIds = Array.isArray(req.body.userIds) ? req.body.userIds : [];
  const group = {
    id: crypto.randomUUID(),
    name,
    userIds: userIds.filter((id) => state.users.some((u) => u.id === id)),
    subToken: genToken(),
    createdAt: new Date().toISOString()
  };
  state.groups.push(group);
  for (const uid of group.userIds) {
    const u = state.users.find((x) => x.id === uid);
    if (u && !u.groupIds.includes(group.id)) u.groupIds.push(group.id);
  }
  store.persist();
  activity.log(actorName(req), 'group_create', `گروه «${group.name}» با ${group.userIds.length} کاربر ساخته شد`);
  res.json(group);
});

router.put('/groups/:id', (req, res) => {
  const state = store.getState();
  const group = state.groups.find((g) => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'گروه پیدا نشد.' });
  if (req.body.name !== undefined) group.name = req.body.name.trim() || group.name;
  if (Array.isArray(req.body.userIds)) {
    // پاک کردن این گروه از کاربران قبلی
    for (const u of state.users) {
      u.groupIds = u.groupIds.filter((id) => id !== group.id);
    }
    group.userIds = req.body.userIds.filter((id) => state.users.some((u) => u.id === id));
    for (const uid of group.userIds) {
      const u = state.users.find((x) => x.id === uid);
      if (u && !u.groupIds.includes(group.id)) u.groupIds.push(group.id);
    }
  }
  store.persist();
  activity.log(actorName(req), 'group_update', `گروه «${group.name}» ویرایش شد`);
  res.json(group);
});

router.delete('/groups/:id', (req, res) => {
  const state = store.getState();
  const idx = state.groups.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'گروه پیدا نشد.' });
  const name = state.groups[idx].name;
  for (const u of state.users) {
    u.groupIds = u.groupIds.filter((id) => id !== req.params.id);
  }
  state.groups.splice(idx, 1);
  store.persist();
  activity.log(actorName(req), 'group_delete', `گروه «${name}» حذف شد`);
  res.json({ ok: true });
});

// ---------- Admins (فقط مالک) ----------

router.get('/admins', requireOwner, (req, res) => {
  const state = store.getState();
  res.json(state.admins.map((a) => ({ id: a.id, username: a.username, role: a.role, createdAt: a.createdAt })));
});

router.post('/admins', requireOwner, (req, res) => {
  const state = store.getState();
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'نام کاربری نامعتبر است.' });
  if (password.length < 6) return res.status(400).json({ error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.' });
  if (state.admins.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'این نام کاربری قبلاً استفاده شده است.' });
  }
  const admin = {
    id: crypto.randomUUID(),
    username,
    passwordHash: hashPassword(password),
    role: 'admin',
    createdAt: new Date().toISOString()
  };
  state.admins.push(admin);
  store.persist();
  activity.log(actorName(req), 'admin_create', `ادمین «${admin.username}» اضافه شد`);
  res.json({ id: admin.id, username: admin.username, role: admin.role });
});

router.delete('/admins/:id', requireOwner, (req, res) => {
  const state = store.getState();
  if (req.params.id === req.admin.id) return res.status(400).json({ error: 'نمی‌توانید حساب خودتان را حذف کنید.' });
  const idx = state.admins.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'ادمین پیدا نشد.' });
  if (state.admins[idx].role === 'owner') return res.status(400).json({ error: 'نمی‌توانید مالک پنل را حذف کنید.' });
  const name = state.admins[idx].username;
  state.admins.splice(idx, 1);
  store.persist();
  activity.log(actorName(req), 'admin_delete', `ادمین «${name}» حذف شد`);
  res.json({ ok: true });
});

// ---------- Settings ----------

router.post('/settings', (req, res) => {
  const state = store.getState();
  const { domain, paths, currentPassword, newPassword, protocolsEnabled } = req.body;

  if (domain !== undefined) {
    state.settings.domain = domain && domain.trim() ? domain.trim() : null;
  }

  if (paths) {
    for (const key of ['vless', 'vmess', 'trojan']) {
      if (typeof paths[key] === 'string' && paths[key].trim()) {
        let v = paths[key].trim();
        if (!v.startsWith('/')) v = '/' + v;
        v = v.replace(/[^a-zA-Z0-9/_-]/g, '');
        if (v.length >= 2) state.settings.paths[key] = v;
      }
    }
  }

  if (protocolsEnabled) {
    state.settings.protocolsEnabled = {
      vless: protocolsEnabled.vless !== false,
      vmess: protocolsEnabled.vmess !== false,
      trojan: protocolsEnabled.trojan !== false
    };
  }

  if (newPassword) {
    const state2 = store.getState();
    const me = state2.admins.find((a) => a.id === req.admin.id);
    if (!currentPassword || !verifyPassword(currentPassword, me.passwordHash)) {
      return res.status(400).json({ error: 'رمز عبور فعلی اشتباه است.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد.' });
    }
    me.passwordHash = hashPassword(newPassword);
  }

  store.persist();
  xray.restart();
  activity.log(actorName(req), 'settings_update', 'تنظیمات پنل به‌روزرسانی شد');
  res.json({ ok: true, settings: state.settings });
});

router.get('/status', (req, res) => {
  res.json(xray.getStatus());
});

router.get('/system-stats', (req, res) => {
  res.json(sysstats.getSystemStats());
});

router.post('/status/restart', (req, res) => {
  xray.restart();
  activity.log(actorName(req), 'xray_restart', 'ری‌استارت دستی Xray');
  res.json({ ok: true });
});

// ---------- Backup / Restore ----------

router.get('/backup', requireOwner, (req, res) => {
  const state = store.getState();
  res.set('Content-Disposition', `attachment; filename="x-ui-ali-backup-${Date.now()}.json"`);
  res.json(state);
});

router.post('/backup/restore', requireOwner, (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.users) || !Array.isArray(incoming.admins)) {
    return res.status(400).json({ error: 'فایل بکاپ نامعتبر است.' });
  }
  const state = store.getState();
  // مالک فعلی حفظ می‌شود تا خودمان از پنل قفل نشویم؛ بقیه اطلاعات از بکاپ بازیابی می‌شود
  const myAdmin = state.admins.find((a) => a.id === req.admin.id);
  incoming.admins = incoming.admins.some((a) => a.id === myAdmin.id) ? incoming.admins : [...incoming.admins, myAdmin];
  Object.assign(state, incoming);
  store.persist();
  xray.restart();
  activity.log(actorName(req), 'backup_restore', 'اطلاعات پنل از فایل بکاپ بازیابی شد');
  res.json({ ok: true });
});

// ---------- Activity ----------

router.get('/activity', (req, res) => {
  res.json(store.getState().activity.slice(0, 100));
});

module.exports = router;
