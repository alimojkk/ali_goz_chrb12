#!/usr/bin/env bash
# =========================================================
# X-ui-ali — اسکریپت نصب ساده روی سرور لینوکسی (VPS) با Docker
# این اسکریپت را داخل پوشه‌ی همین پروژه (کنار Dockerfile) اجرا کنید:
#
#   chmod +x install.sh
#   ./install.sh
#
# کاری که انجام می‌دهد:
#   ۱. اگر Docker نصب نباشد، نصبش می‌کند.
#   ۲. ایمیج X-ui-ali را می‌سازد (شامل دانلود خودکار Xray-core).
#   ۳. یک Volume برای ذخیره‌سازی دائمی داده‌ها می‌سازد.
#   ۴. کانتینر را با پورت و Volume مناسب اجرا می‌کند.
#
# نکته: این اسکریپت برای نصب روی VPS/سرور شخصی شماست.
# برای دیپلوی روی Railway از فایل install_railway.sh یا راهنمای README استفاده کنید.
# =========================================================
set -euo pipefail

APP_NAME="x-ui-ali"
IMAGE_NAME="x-ui-ali:latest"
VOLUME_NAME="x_ui_ali_data"
DEFAULT_PORT=8080

info()  { echo -e "\033[1;36m[i]\033[0m $1"; }
ok()    { echo -e "\033[1;32m[✓]\033[0m $1"; }
warn()  { echo -e "\033[1;33m[!]\033[0m $1"; }
err()   { echo -e "\033[1;31m[x]\033[0m $1"; }

# ---------- ۱) بررسی/نصب Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker پیدا نشد. در حال نصب Docker..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  else
    err "دستور curl پیدا نشد. لطفاً ابتدا curl یا Docker را دستی نصب کنید."
    exit 1
  fi
  systemctl enable docker >/dev/null 2>&1 || true
  systemctl start docker >/dev/null 2>&1 || true
  ok "Docker نصب شد."
else
  ok "Docker از قبل نصب است."
fi

# ---------- ۲) گرفتن پورت دلخواه ----------
read -rp "پورتی که می‌خواهید پنل روی سرور شما گوش دهد [پیش‌فرض: ${DEFAULT_PORT}]: " USER_PORT
PORT="${USER_PORT:-$DEFAULT_PORT}"

# ---------- ۳) بیلد ایمیج ----------
info "در حال ساخت ایمیج Docker (شامل دانلود Xray-core)... ممکن است چند دقیقه طول بکشد."
docker build -t "$IMAGE_NAME" .
ok "ایمیج با موفقیت ساخته شد."

# ---------- ۴) ساخت Volume دائمی ----------
if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  docker volume create "$VOLUME_NAME" >/dev/null
  ok "Volume دائمی «$VOLUME_NAME» ساخته شد."
else
  ok "Volume دائمی «$VOLUME_NAME» از قبل وجود دارد."
fi

# ---------- ۵) حذف کانتینر قبلی (در صورت وجود) و اجرای نسخه جدید ----------
if docker ps -a --format '{{.Names}}' | grep -qx "$APP_NAME"; then
  warn "کانتینر قبلی «$APP_NAME» پیدا شد؛ در حال حذف و جایگزینی..."
  docker rm -f "$APP_NAME" >/dev/null
fi

docker run -d \
  --name "$APP_NAME" \
  --restart unless-stopped \
  -p "${PORT}:8080" \
  -e PORT=8080 \
  -e DATA_DIR=/data \
  -v "${VOLUME_NAME}:/data" \
  "$IMAGE_NAME"

ok "نصب کامل شد 🎉"
echo
info "پنل روی همین سرور در حال اجراست: http://<IP-سرور-شما>:${PORT}"
info "اگر پشت دامنه/Reverse Proxy (مثل Nginx/Caddy) هستید، آن را به همین پورت هدایت کنید و TLS را در آنجا تنظیم کنید."
info "برای دیدن لاگ‌ها:   docker logs -f ${APP_NAME}"
info "برای ری‌استارت:    docker restart ${APP_NAME}"
info "برای آپدیت بعدی:   git pull && ./install.sh"
