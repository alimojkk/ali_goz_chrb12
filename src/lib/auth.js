'use strict';
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const store = require('./store');

const COOKIE_NAME = 'xuiali_session';
const SESSION_TTL = '12h';

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch (_) {
    return false;
  }
}

function findAdminByUsername(state, username) {
  return state.admins.find((a) => a.username.toLowerCase() === String(username || '').toLowerCase());
}

function signSession(admin) {
  const state = store.getState();
  return jwt.sign({ id: admin.id, u: admin.username, role: admin.role }, state.settings.secretKey, {
    expiresIn: SESSION_TTL
  });
}

function verifySession(token) {
  const state = store.getState();
  try {
    return jwt.verify(token, state.settings.secretKey);
  } catch (_) {
    return null;
  }
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // TLS در edge خود Railway ترمینیت می‌شود
    maxAge: 12 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  const payload = token ? verifySession(token) : null;
  if (!payload) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return res.redirect('/login');
  }
  const state = store.getState();
  const admin = state.admins.find((a) => a.id === payload.id);
  if (!admin) {
    clearSessionCookie(res);
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    return res.redirect('/login');
  }
  req.admin = { id: admin.id, u: admin.username, role: admin.role };
  next();
}

function requireOwner(req, res, next) {
  if (!req.admin || req.admin.role !== 'owner') {
    if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'فقط مالک پنل به این بخش دسترسی دارد.' });
    return res.status(403).send('فقط مالک پنل (Owner) به این بخش دسترسی دارد.');
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireOwner,
  findAdminByUsername
};
