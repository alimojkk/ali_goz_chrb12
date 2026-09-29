'use strict';
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const store = require('../lib/store');
const links = require('../lib/links');
const xray = require('../lib/xray');

function findUserByToken(token) {
  const state = store.getState();
  return state.users.find((u) => u.subToken === token);
}
function findGroupByToken(token) {
  const state = store.getState();
  return state.groups.find((g) => g.subToken === token);
}

function buildUserInfoHeader(user) {
  const upload = 0;
  const download = user.trafficUsedBytes || 0;
  const total = user.trafficLimitGB ? user.trafficLimitGB * 1024 * 1024 * 1024 : 0;
  const expire = user.expiresAt ? Math.floor(new Date(user.expiresAt).getTime() / 1000) : 0;
  return `upload=${upload}; download=${download}; total=${total}; expire=${expire}`;
}

// ---------- ساب تکی ----------

router.get('/sub/:token', (req, res) => {
  const state = store.getState();
  const user = findUserByToken(req.params.token);
  if (!user) return res.status(404).send('Not found');
  const userLinks = links.buildUserLinks(user, state.settings);
  const raw = userLinks.map((l) => l.link).join('\n');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Profile-Update-Interval', '12');
  res.set('Subscription-Userinfo', buildUserInfoHeader(user));
  res.send(Buffer.from(raw, 'utf8').toString('base64'));
});

router.get('/s/:token', async (req, res) => {
  const state = store.getState();
  const user = findUserByToken(req.params.token);
  if (!user) return res.status(404).send('کاربر پیدا نشد یا لینک نامعتبر است.');

  const userLinks = links.buildUserLinks(user, state.settings);
  const withQr = await Promise.all(
    userLinks.map(async (l) => ({
      ...l,
      qr: await QRCode.toDataURL(l.link, { margin: 1, width: 280 })
    }))
  );

  const subUrl = `${req.protocol}://${req.get('host')}/sub/${user.subToken}`;
  const subQr = await QRCode.toDataURL(subUrl, { margin: 1, width: 220 });

  res.render('sub_page', {
    user,
    links: withQr,
    subUrl,
    subQr,
    active: xray.isUserActive(user),
    usedGB: ((user.trafficUsedBytes || 0) / (1024 * 1024 * 1024)).toFixed(2),
    limitGB: user.trafficLimitGB || 0
  });
});

// ---------- ساب گروهی ----------

router.get('/gsub/:token', (req, res) => {
  const state = store.getState();
  const group = findGroupByToken(req.params.token);
  if (!group) return res.status(404).send('Not found');
  const members = state.users.filter((u) => group.userIds.includes(u.id));
  const all = links.buildGroupLinks(members, state.settings);
  const raw = all.map((l) => l.link).join('\n');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(Buffer.from(raw, 'utf8').toString('base64'));
});

router.get('/gs/:token', async (req, res) => {
  const state = store.getState();
  const group = findGroupByToken(req.params.token);
  if (!group) return res.status(404).send('گروه پیدا نشد یا لینک نامعتبر است.');
  const members = state.users.filter((u) => group.userIds.includes(u.id));
  const all = links.buildGroupLinks(members, state.settings);
  const withQr = await Promise.all(
    all.map(async (l) => ({ ...l, qr: await QRCode.toDataURL(l.link, { margin: 1, width: 240 }) }))
  );
  const subUrl = `${req.protocol}://${req.get('host')}/gsub/${group.subToken}`;
  const subQr = await QRCode.toDataURL(subUrl, { margin: 1, width: 220 });

  res.render('group_sub_page', {
    group,
    members,
    links: withQr,
    subUrl,
    subQr
  });
});

module.exports = router;
