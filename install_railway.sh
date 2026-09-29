#!/usr/bin/env bash
# =========================================================
# X-ui-ali — نصب خودکار روی Railway با استفاده از Railway CLI
#
# این روش جایگزین «Fork در گیت‌هاب + Deploy from GitHub repo» است؛
# مستقیماً از روی همین پوشه روی سیستم شما دیپلوی می‌کند (نیازی به
# گیت‌هاب ندارد، هرچند همچنان توصیه می‌شود پروژه را در گیت‌هاب هم نگه دارید).
#
# استفاده:
#   chmod +x install_railway.sh
#   ./install_railway.sh
#
# پیش‌نیاز: یک حساب کاربری در https://railway.com
# =========================================================
set -euo pipefail

info()  { echo -e "\033[1;36m[i]\033[0m $1"; }
ok()    { echo -e "\033[1;32m[✓]\033[0m $1"; }
warn()  { echo -e "\033[1;33m[!]\033[0m $1"; }
err()   { echo -e "\033[1;31m[x]\033[0m $1"; }

# ---------- ۱) نصب Railway CLI در صورت نبود ----------
if ! command -v railway >/dev/null 2>&1; then
  warn "Railway CLI پیدا نشد. در حال نصب..."
  if command -v npm >/dev/null 2>&1; then
    npm i -g @railway/cli
  else
    bash <(curl -fsSL railway.com/install.sh)
  fi
  ok "Railway CLI نصب شد."
else
  ok "Railway CLI از قبل نصب است."
fi

# ---------- ۲) ورود به حساب Railway ----------
if ! railway whoami >/dev/null 2>&1; then
  info "برای ادامه باید وارد حساب Railway شوید (یک تب مرورگر باز می‌شود)."
  railway login
else
  ok "قبلاً وارد حساب Railway شده‌اید: $(railway whoami 2>/dev/null || true)"
fi

# ---------- ۳) ساخت/لینک پروژه ----------
read -rp "نام پروژه در Railway [پیش‌فرض: x-ui-ali]: " PROJECT_NAME
PROJECT_NAME="${PROJECT_NAME:-x-ui-ali}"

if [ ! -d ".railway" ]; then
  info "در حال ساخت پروژه جدید «$PROJECT_NAME» در Railway..."
  railway init --name "$PROJECT_NAME" || railway init
else
  ok "این پوشه از قبل به یک پروژه Railway متصل است."
fi

# ---------- ۴) دیپلوی ----------
info "در حال آپلود و دیپلوی پروژه (بیلد Docker شامل دانلود Xray-core، چند دقیقه طول می‌کشد)..."
railway up --detach
ok "درخواست دیپلوی ارسال شد."

# ---------- ۵) ساخت Volume دائمی روی /data ----------
info "در حال ساخت Volume دائمی روی مسیر /data ..."
if railway volume add --mount-path /data; then
  ok "Volume با موفقیت ساخته/متصل شد."
else
  warn "ساخت خودکار Volume ممکن نشد (شاید از قبل وجود دارد). از داشبورد Railway بررسی کنید: Settings → Volumes → مسیر /data"
fi

# ---------- ۶) ساخت دامنه عمومی روی پورت 8080 ----------
info "در حال ساخت دامنه عمومی (پورت 8080)..."
railway domain --port 8080 || warn "ساخت خودکار دامنه ممکن نشد؛ از Settings → Networking → Generate Domain (پورت 8080) استفاده کنید."

echo
ok "نصب کامل شد 🎉"
info "برای دیدن آدرس نهایی:  railway domain list"
info "برای دیدن لاگ‌های زنده: railway logs"
info "برای باز کردن پروژه در مرورگر: railway open"
info "حالا آدرس دامنه را باز کنید؛ چون اولین اجراست، به‌طور خودکار به صفحه Setup می‌روید و حساب مدیر را می‌سازید."
