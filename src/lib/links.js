'use strict';
/*
 * ساخت لینک‌های کلاینت (vless/vmess/trojan) از روی اطلاعات کاربر و تنظیمات پنل.
 * نکته مهم: ریمارک (نام نمایشی) هر کانفیگ همیشه دقیقاً همان «نام کاربری»‌ای است
 * که در پنل هنگام ساخت کاربر وارد کرده‌اید — هیچ پسوند، برند یا متن اضافه‌ای
 * به آن اضافه نمی‌شود.
 */

function getPublicDomain(settings) {
  return (
    settings.domain ||
    process.env.PUBLIC_DOMAIN ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    'localhost'
  );
}

function buildVlessLink(user, settings) {
  const domain = getPublicDomain(settings);
  const path = encodeURIComponent(settings.paths.vless);
  const remark = encodeURIComponent(user.username);
  return (
    `vless://${user.uuid}@${domain}:443?` +
    `encryption=none&security=tls&sni=${domain}&fp=chrome&alpn=http%2F1.1&type=ws&host=${domain}&path=${path}` +
    `#${remark}`
  );
}

function buildVmessLink(user, settings) {
  const domain = getPublicDomain(settings);
  const obj = {
    v: '2',
    ps: user.username,
    add: domain,
    port: '443',
    id: user.uuid,
    aid: '0',
    scy: 'auto',
    net: 'ws',
    type: 'none',
    host: domain,
    path: settings.paths.vmess,
    tls: 'tls',
    sni: domain,
    alpn: 'http/1.1',
    fp: 'chrome'
  };
  return 'vmess://' + Buffer.from(JSON.stringify(obj)).toString('base64');
}

function buildTrojanLink(user, settings) {
  const domain = getPublicDomain(settings);
  const path = encodeURIComponent(settings.paths.trojan);
  const remark = encodeURIComponent(user.username);
  return (
    `trojan://${user.uuid}@${domain}:443?` +
    `security=tls&sni=${domain}&fp=chrome&alpn=http%2F1.1&type=ws&host=${domain}&path=${path}` +
    `#${remark}`
  );
}

function buildUserLinks(user, settings) {
  const links = [];
  if (!user.protocols || user.protocols.vless) links.push({ protocol: 'VLESS', key: 'vless', link: buildVlessLink(user, settings) });
  if (!user.protocols || user.protocols.vmess) links.push({ protocol: 'VMess', key: 'vmess', link: buildVmessLink(user, settings) });
  if (!user.protocols || user.protocols.trojan) links.push({ protocol: 'Trojan', key: 'trojan', link: buildTrojanLink(user, settings) });
  return links;
}

function buildGroupLinks(members, settings) {
  // members: آرایه‌ای از رکوردهای کاربر؛ خروجی شامل همه کانفیگ‌های همه اعضا با نام کاربری هرکدام است
  const out = [];
  for (const user of members) {
    for (const l of buildUserLinks(user, settings)) {
      out.push({ ...l, username: user.username });
    }
  }
  return out;
}

module.exports = {
  getPublicDomain,
  buildVlessLink,
  buildVmessLink,
  buildTrojanLink,
  buildUserLinks,
  buildGroupLinks
};
