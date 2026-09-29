'use strict';
const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const { requireAuth, requireOwner } = require('../lib/auth');
const xray = require('../lib/xray');
const links = require('../lib/links');
const activity = require('../lib/activity');
const sysstats = require('../lib/sysstats');
const QRCode = require('qrcode');

router.use(requireAuth);

router.get('/', (req, res) => {
  const state = store.getState();
  const totalUsers = state.users.length;
  const activeUsers = state.users.filter((u) => xray.isUserActive(u)).length;
  const expiredOrOver = state.users.filter((u) => u.enabled && !xray.isUserActive(u)).length;
  const totalTrafficGB =
    state.users.reduce((sum, u) => sum + (u.trafficUsedBytes || 0), 0) / (1024 * 1024 * 1024);

  const chart = state.trafficHistory.slice(-14).map((e) => ({
    date: e.date,
    gb: +(e.bytes / (1024 * 1024 * 1024)).toFixed(3)
  }));

  res.render('dashboard', {
    admin: req.admin,
    totalUsers,
    activeUsers,
    expiredOrOver,
    totalGroups: state.groups.length,
    totalTrafficGB: totalTrafficGB.toFixed(2),
    status: xray.getStatus(),
    domain: links.getPublicDomain(state.settings),
    sys: sysstats.getSystemStats(),
    sysFmt: sysstats,
    chart,
    recentActivity: state.activity.slice(0, 6),
    activityIcon: activity.iconFor
  });
});

router.get('/users', (req, res) => {
  const state = store.getState();
  const domain = links.getPublicDomain(state.settings);
  res.render('users', { users: state.users, groups: state.groups, domain, isActive: xray.isUserActive, admin: req.admin });
});

router.get('/users/:id', async (req, res) => {
  const state = store.getState();
  const user = state.users.find((u) => u.id === req.params.id);
  if (!user) return res.redirect('/users');
  const userLinks = links.buildUserLinks(user, state.settings);
  const withQr = await Promise.all(
    userLinks.map(async (l) => ({ ...l, qr: await QRCode.toDataURL(l.link, { margin: 1, width: 220 }) }))
  );
  const domain = links.getPublicDomain(state.settings);
  const myGroups = state.groups.filter((g) => user.groupIds.includes(g.id));
  res.render('user_detail', {
    admin: req.admin,
    user,
    userLinks: withQr,
    domain,
    myGroups,
    subUrl: `https://${domain}/sub/${user.subToken}`,
    subPageUrl: `https://${domain}/s/${user.subToken}`,
    isActive: xray.isUserActive(user)
  });
});

router.get('/groups', (req, res) => {
  const state = store.getState();
  const domain = links.getPublicDomain(state.settings);
  res.render('groups', { groups: state.groups, users: state.users, domain, admin: req.admin });
});

router.get('/groups/:id', (req, res) => {
  const state = store.getState();
  const group = state.groups.find((g) => g.id === req.params.id);
  if (!group) return res.redirect('/groups');
  const domain = links.getPublicDomain(state.settings);
  const members = state.users.filter((u) => group.userIds.includes(u.id));
  const others = state.users.filter((u) => !group.userIds.includes(u.id));
  res.render('group_detail', {
    admin: req.admin,
    group,
    members,
    others,
    domain,
    subUrl: `https://${domain}/gsub/${group.subToken}`,
    subPageUrl: `https://${domain}/gs/${group.subToken}`
  });
});

router.get('/activity', (req, res) => {
  const state = store.getState();
  res.render('activity', { items: state.activity.slice(0, 150), activityIcon: activity.iconFor, admin: req.admin });
});

router.get('/admins', requireOwner, (req, res) => {
  const state = store.getState();
  res.render('admins', { admins: state.admins, me: req.admin, admin: req.admin });
});

router.get('/settings', (req, res) => {
  const state = store.getState();
  res.render('settings', {
    settings: state.settings,
    admin: req.admin,
    isOwner: req.admin.role === 'owner',
    status: xray.getStatus(),
    domain: links.getPublicDomain(state.settings)
  });
});

module.exports = router;
