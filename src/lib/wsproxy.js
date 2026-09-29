'use strict';
/*
 * پراکسی سطح‌پایین: درخواست‌های HTTP Upgrade (WebSocket) که از سمت کلاینت‌های
 * VLESS/VMess/Trojan روی مسیرهای مشخص می‌رسند را بدون دست‌کاری، مستقیماً
 * به اینباند داخلی Xray (روی 127.0.0.1) هدایت می‌کند. این کار باعث می‌شود
 * پنل و ترافیک VPN هر دو از یک پورت واحد که Railway در اختیار می‌گذارد رد شوند.
 */
const net = require('net');
const url = require('url');
const store = require('./store');

function attach(server, xray) {
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    let pathname;
    try {
      pathname = url.parse(req.url).pathname;
    } catch (_) {
      socket.destroy();
      return;
    }

    const state = store.getState();
    const map = {
      [state.settings.paths.vless]: xray.PORTS.vless,
      [state.settings.paths.vmess]: xray.PORTS.vmess,
      [state.settings.paths.trojan]: xray.PORTS.trojan
    };
    const target = map[pathname];
    if (!target) {
      socket.destroy();
      return;
    }

    const upstream = net.connect(target, '127.0.0.1');
    upstream.on('connect', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push('', '');
      upstream.write(lines.join('\r\n'));
      if (head && head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => {
      try {
        socket.destroy();
      } catch (_) {}
    });
    socket.on('close', () => {
      try {
        upstream.destroy();
      } catch (_) {}
    });
  });
}

module.exports = { attach };
