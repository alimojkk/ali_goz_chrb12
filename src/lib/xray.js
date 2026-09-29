'use strict';
/*
 * مدیریت پردازه Xray-core: تولید کانفیگ از روی وضعیت پنل، اجرا/ری‌استارت،
 * خواندن آمار مصرف هر کاربر (`xray api statsquery`)، به‌روزرسانی تاریخچه ترافیک روزانه،
 * و پیاده‌سازی استراتژی انقضای «شروع از اولین اتصال».
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const store = require('./store');

const XRAY_BIN = process.env.XRAY_BIN || path.join(__dirname, '..', '..', 'bin', 'xray');
const CONFIG_PATH = path.join(store.DATA_DIR, 'xray-config.json');
const API_PORT = parseInt(process.env.XRAY_API_PORT || '10085', 10);
const BASE_PORT = parseInt(process.env.XRAY_INBOUND_BASE_PORT || '20000', 10);

const PORTS = {
  vless: BASE_PORT + 1,
  vmess: BASE_PORT + 2,
  trojan: BASE_PORT + 3
};

let proc = null;
let restarting = false;
let pendingRestart = false;
let lastLog = [];
let lastError = null;
let lastStartedAt = null;

function pushLog(line) {
  lastLog.push(`[${new Date().toISOString()}] ${line}`);
  if (lastLog.length > 300) lastLog.shift();
}

function isUserActive(user) {
  if (!user.enabled) return false;
  if (user.expiresAt && new Date(user.expiresAt).getTime() < Date.now()) return false;
  if (user.trafficLimitGB && user.trafficLimitGB > 0) {
    const limitBytes = user.trafficLimitGB * 1024 * 1024 * 1024;
    if ((user.trafficUsedBytes || 0) >= limitBytes) return false;
  }
  return true;
}

function sanitizePath(p, fallback) {
  if (typeof p !== 'string') return fallback;
  let v = p.trim();
  if (!v.startsWith('/')) v = '/' + v;
  v = v.replace(/[^a-zA-Z0-9/_-]/g, '');
  if (v.length < 2) return fallback;
  return v;
}

function buildConfig(state) {
  const activeUsers = state.users.filter(isUserActive);
  const proto = state.settings.protocolsEnabled || { vless: true, vmess: true, trojan: true };

  const vlessClients = activeUsers
    .filter((u) => !u.protocols || u.protocols.vless)
    .map((u) => ({ id: u.uuid, email: u.username, level: 0 }));

  const vmessClients = activeUsers
    .filter((u) => !u.protocols || u.protocols.vmess)
    .map((u) => ({ id: u.uuid, alterId: 0, email: u.username, level: 0 }));

  const trojanClients = activeUsers
    .filter((u) => !u.protocols || u.protocols.trojan)
    .map((u) => ({ password: u.uuid, email: u.username, level: 0 }));

  const pVless = sanitizePath(state.settings.paths.vless, '/vless');
  const pVmess = sanitizePath(state.settings.paths.vmess, '/vmess');
  const pTrojan = sanitizePath(state.settings.paths.trojan, '/trojan');

  const inbounds = [
    {
      tag: 'api',
      listen: '127.0.0.1',
      port: API_PORT,
      protocol: 'dokodemo-door',
      settings: { address: '127.0.0.1' }
    }
  ];

  if (proto.vless !== false) {
    inbounds.push({
      tag: 'vless-in',
      listen: '127.0.0.1',
      port: PORTS.vless,
      protocol: 'vless',
      settings: { clients: vlessClients, decryption: 'none' },
      streamSettings: { network: 'ws', security: 'none', wsSettings: { path: pVless } },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] }
    });
  }
  if (proto.vmess !== false) {
    inbounds.push({
      tag: 'vmess-in',
      listen: '127.0.0.1',
      port: PORTS.vmess,
      protocol: 'vmess',
      settings: { clients: vmessClients },
      streamSettings: { network: 'ws', security: 'none', wsSettings: { path: pVmess } },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] }
    });
  }
  if (proto.trojan !== false) {
    inbounds.push({
      tag: 'trojan-in',
      listen: '127.0.0.1',
      port: PORTS.trojan,
      protocol: 'trojan',
      settings: { clients: trojanClients },
      streamSettings: { network: 'ws', security: 'none', wsSettings: { path: pTrojan } },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] }
    });
  }

  return {
    log: { loglevel: 'warning' },
    api: { tag: 'api', services: ['StatsService', 'HandlerService'] },
    stats: {},
    policy: {
      levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsInboundUplink: true, statsInboundDownlink: true }
    },
    inbounds,
    outbounds: [
      { protocol: 'freedom', tag: 'direct' },
      { protocol: 'blackhole', tag: 'blocked' }
    ],
    routing: {
      rules: [{ type: 'field', inboundTag: ['api'], outboundTag: 'api' }]
    }
  };
}

function writeConfigFile() {
  const state = store.getState();
  const cfg = buildConfig(state);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return CONFIG_PATH;
}

function binExists() {
  try {
    fs.accessSync(XRAY_BIN, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function start() {
  if (!binExists()) {
    lastError = `فایل اجرایی Xray پیدا نشد: ${XRAY_BIN}`;
    pushLog(lastError);
    return;
  }
  writeConfigFile();
  pushLog('در حال اجرای Xray-core...');
  const child = spawn(XRAY_BIN, ['run', '-config', CONFIG_PATH], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc = child;
  lastStartedAt = new Date().toISOString();
  lastError = null;

  child.stdout.on('data', (d) => pushLog(d.toString().trim()));
  child.stderr.on('data', (d) => pushLog(d.toString().trim()));

  // بسیار مهم: بدون این listener، هر خطای spawn (باینری اجرا نشد، دسترسی نداشت و ...)
  // به یک exception گرفته‌نشده در سطح پردازه تبدیل می‌شود و کل پنل (نه فقط Xray) کرش می‌کند.
  // با این handler، فقط Xray از کار می‌افتد و پنل وب سالم و در دسترس باقی می‌ماند.
  child.on('error', (err) => {
    lastError = `اجرای Xray با خطا مواجه شد: ${err.message}`;
    pushLog(lastError);
    if (proc === child) proc = null;
  });

  child.on('exit', (code, signal) => {
    pushLog(`Xray متوقف شد (code=${code}, signal=${signal})`);
    if (proc === child) proc = null;
    if (pendingRestart) {
      pendingRestart = false;
      setTimeout(doStart, 300);
    } else if (code !== 0 && code !== null && proc === null) {
      setTimeout(() => {
        if (!proc) doStart();
      }, 2000);
    }
  });
}

function doStart() {
  start();
}

function stop() {
  return new Promise((resolve) => {
    if (!proc) return resolve();
    const target = proc;
    let timer = null;
    target.once('exit', () => {
      if (timer) clearTimeout(timer);
      resolve();
    });
    try {
      target.kill('SIGTERM');
    } catch (_) {}
    timer = setTimeout(() => {
      try {
        target.kill('SIGKILL');
      } catch (_) {}
    }, 3000);
  });
}

async function restart() {
  if (restarting) {
    pendingRestart = true;
    return;
  }
  restarting = true;
  try {
    await stop();
    doStart();
  } finally {
    restarting = false;
  }
}

function getStatus() {
  return {
    running: !!proc,
    pid: proc ? proc.pid : null,
    startedAt: lastStartedAt,
    lastError,
    logs: lastLog.slice(-80),
    ports: PORTS,
    apiPort: API_PORT,
    binExists: binExists()
  };
}

function statsQuery() {
  return new Promise((resolve) => {
    if (!binExists()) return resolve(null);
    execFile(
      XRAY_BIN,
      ['api', 'statsquery', `-server=127.0.0.1:${API_PORT}`],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed.stat || []);
        } catch (_) {
          resolve(null);
        }
      }
    );
  });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addToTrafficHistory(state, bytes) {
  if (!bytes || bytes <= 0) return;
  const key = todayKey();
  let entry = state.trafficHistory.find((e) => e.date === key);
  if (!entry) {
    entry = { date: key, bytes: 0 };
    state.trafficHistory.push(entry);
  }
  entry.bytes += bytes;
  if (state.trafficHistory.length > 60) {
    state.trafficHistory.splice(0, state.trafficHistory.length - 60);
  }
}

// هر ۲۰ ثانیه آمار مصرف را از Xray می‌خواند، به ازای هر کاربر جمع می‌زند،
// تاریخچه ترافیک روزانه را به‌روز می‌کند، استراتژی انقضای «شروع از اولین اتصال»
// را اعمال می‌کند و در صورت عبور از سقف مصرف/انقضا، کانفیگ را بازسازی می‌کند.
let statsTimer = null;
function startStatsPolling(intervalMs) {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = setInterval(async () => {
    try {
      const stats = await statsQuery();
      if (!stats || !stats.length) return;
      const state = store.getState();
      let changed = false;
      let needsRestart = false;
      let totalDelta = 0;
      const byUser = {};
      for (const s of stats) {
        const m = /^user>>>(.+?)>>>traffic>>>(uplink|downlink)$/.exec(s.name || '');
        if (!m) continue;
        const email = m[1];
        const val = Number(s.value || 0);
        if (!byUser[email]) byUser[email] = 0;
        byUser[email] += val;
      }
      for (const user of state.users) {
        const used = byUser[user.username];
        if (used && used > 0) {
          const wasActive = isUserActive(user);
          user.trafficUsedBytes = (user.trafficUsedBytes || 0) + used;
          totalDelta += used;
          changed = true;

          // استراتژی انقضای «شروع از اولین اتصال»
          if (user.expireStrategy === 'first_use' && !user.firstConnectedAt && user.expireDays) {
            user.firstConnectedAt = new Date().toISOString();
            user.expiresAt = new Date(Date.now() + user.expireDays * 86400000).toISOString();
          }

          const nowActive = isUserActive(user);
          if (wasActive && !nowActive) needsRestart = true;
        }
      }
      if (totalDelta > 0) addToTrafficHistory(state, totalDelta);
      if (changed) store.persist();
      if (needsRestart) restart();
    } catch (_) {
      // نادیده گرفتن خطای موقتی جمع‌آوری آمار
    }
  }, intervalMs || 20000);
}

module.exports = {
  PORTS,
  API_PORT,
  XRAY_BIN,
  isUserActive,
  buildConfig,
  writeConfigFile,
  start,
  stop,
  restart,
  getStatus,
  statsQuery,
  startStatsPolling,
  binExists
};
