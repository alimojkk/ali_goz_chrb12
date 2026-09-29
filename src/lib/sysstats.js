'use strict';
/* آمار زنده سیستم (CPU/RAM/دیسک/آپ‌تایم) — فقط با ماژول‌های داخلی Node، بدون وابستگی اضافه */
const os = require('fs');
const osMod = require('os');
const store = require('./store');

function getSystemStats() {
  const result = {
    cpuCount: osMod.cpus().length,
    loadavg: osMod.loadavg(),
    memTotal: osMod.totalmem(),
    memFree: osMod.freemem(),
    uptime: osMod.uptime(),
    disk: null
  };
  result.memUsed = result.memTotal - result.memFree;
  result.memUsedPercent = result.memTotal ? Math.round((result.memUsed / result.memTotal) * 100) : 0;
  result.cpuLoadPercent = result.cpuCount
    ? Math.min(100, Math.round((result.loadavg[0] / result.cpuCount) * 100))
    : 0;

  try {
    const stat = os.statfsSync(store.DATA_DIR);
    const total = stat.blocks * stat.bsize;
    const free = stat.bfree * stat.bsize;
    const used = total - free;
    result.disk = {
      total,
      free,
      used,
      usedPercent: total ? Math.round((used / total) * 100) : 0
    };
  } catch (_) {
    result.disk = null;
  }

  return result;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}روز`);
  if (h) parts.push(`${h}ساعت`);
  parts.push(`${m}دقیقه`);
  return parts.join(' ');
}

module.exports = { getSystemStats, formatBytes, formatUptime };
