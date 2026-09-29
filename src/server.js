'use strict';
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');

const store = require('./lib/store');
const xray = require('./lib/xray');
const wsproxy = require('./lib/wsproxy');

const authRoutes = require('./routes/auth');
const pageRoutes = require('./routes/pages');
const apiRoutes = require('./routes/api');
const subRoutes = require('./routes/sub');

// شبکهٔ ایمنی سراسری: هیچ خطای پیش‌بینی‌نشده نباید کل پنل را آفلاین کند.
// (مثلاً اگر اجرای Xray یا یک درخواست غیرمنتظره خطا بدهد، فقط لاگ می‌شود
// و وب‌سرور اصلی پنل به کار خودش ادامه می‌دهد.)
process.on('uncaughtException', (err) => {
  console.error('uncaughtException (نادیده گرفته شد تا پنل آفلاین نشود):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection (نادیده گرفته شد تا پنل آفلاین نشود):', err);
});

// بارگذاری/ساخت وضعیت اولیه پیش از هر چیز
store.load();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/', authRoutes);
app.use('/api', apiRoutes);
app.use('/', subRoutes);
app.use('/', pageRoutes);

app.use((req, res) => res.status(404).send('404 - صفحه پیدا نشد'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('500 - خطای داخلی سرور');
});

const PORT = parseInt(process.env.PORT || '8080', 10);
const server = http.createServer(app);

// اتصال ترافیک WebSocket (VLESS/VMess/Trojan) روی همان پورت اصلی
wsproxy.attach(server, xray);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`X-ui-ali در حال اجرا روی پورت ${PORT}`);
  xray.start();
  xray.startStatsPolling(20000);
});

function shutdown() {
  console.log('در حال خاموش کردن...');
  xray.stop().finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
