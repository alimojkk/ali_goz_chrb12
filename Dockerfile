# =========================================================
# X-ui-ali — Dockerfile مخصوص Railway
# پنل (Node.js) + هسته Xray-core (دانلود خودکار در زمان بیلد)
# =========================================================
FROM node:20-alpine

# ابزارهای لازم برای دانلود و اجرای Xray
RUN apk add --no-cache curl unzip ca-certificates tini

WORKDIR /app

# ---- نصب وابستگی‌های Node (فقط production، بدون نیاز به build native) ----
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- دانلود Xray-core (نسخه پین‌شده و تست‌شده) ----
ARG XRAY_VERSION=v26.3.27
RUN set -eux; \
    ARCH=$(uname -m); \
    case "$ARCH" in \
      x86_64) XARCH=64 ;; \
      aarch64) XARCH=arm64-v8a ;; \
      armv7l) XARCH=arm32-v7a ;; \
      *) echo "معماری پشتیبانی‌نشده: $ARCH" && exit 1 ;; \
    esac; \
    mkdir -p /app/bin; \
    curl -fsSL -o /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-${XARCH}.zip"; \
    unzip -o /tmp/xray.zip -d /app/bin xray; \
    chmod +x /app/bin/xray; \
    rm -f /tmp/xray.zip

# ---- کپی کد برنامه ----
COPY src ./src

# مسیر داده‌ی دائمی — روی Railway یک Volume به همین مسیر وصل کنید
ENV DATA_DIR=/data
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

VOLUME ["/data"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
