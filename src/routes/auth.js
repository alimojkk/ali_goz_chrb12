'use strict';
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const store = require('../lib/store');
const auth = require('../lib/auth');
const activity = require('../lib/activity');

router.get('/setup', (req, res) => {
  const state = store.getState();
  if (state.admins.length) return res.redirect('/login');
  res.render('setup', { error: null });
});

router.post('/setup', (req, res) => {
  const state = store.getState();
  if (state.admins.length) return res.redirect('/login');
  const { username, password, confirm } = req.body;
  if (!username || !password || username.trim().length < 3) {
    return res.render('setup', { error: 'نام کاربری باید حداقل ۳ کاراکتر باشد.' });
  }
  if (password.length < 6) {
    return res.render('setup', { error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.' });
  }
  if (password !== confirm) {
    return res.render('setup', { error: 'رمز عبور و تکرار آن یکسان نیستند.' });
  }
  const admin = {
    id: crypto.randomUUID(),
    username: username.trim(),
    passwordHash: auth.hashPassword(password),
    role: 'owner',
    createdAt: new Date().toISOString()
  };
  state.admins.push(admin);
  store.persist();
  activity.log(admin.username, 'login', 'ساخت حساب مالک و ورود اولیه');
  const token = auth.signSession(admin);
  auth.setSessionCookie(res, token);
  res.redirect('/');
});

router.get('/login', (req, res) => {
  const state = store.getState();
  if (!state.admins.length) return res.redirect('/setup');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const state = store.getState();
  if (!state.admins.length) return res.redirect('/setup');
  const { username, password } = req.body;
  const admin = auth.findAdminByUsername(state, username);
  if (admin && password && auth.verifyPassword(password, admin.passwordHash)) {
    const token = auth.signSession(admin);
    auth.setSessionCookie(res, token);
    activity.log(admin.username, 'login', 'ورود موفق');
    return res.redirect('/');
  }
  activity.log(username || '?', 'login_failed', 'تلاش ناموفق برای ورود');
  res.render('login', { error: 'نام کاربری یا رمز عبور اشتباه است.' });
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.redirect('/login');
});

module.exports = router;
