# --- етап 1: завантаження supercronic (curl лише тут) ---
# Версія та SHA1 взяті з офіційних release notes:
# https://github.com/aptible/supercronic/releases/tag/v0.2.49
FROM node:22.20.0-bookworm-slim AS supercronic
# Без інтерактивних питань debconf під час apt-get (лише на час збірки, не ENV)
ARG DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    ARCH="$(dpkg --print-architecture)"; \
    case "$ARCH" in \
      amd64) SHA1=e63c11a9726b775a6a11801e81af4f3fb926aa68 ;; \
      arm64) SHA1=0b6c5bb743e0b0dafed1132198c81807927ac413 ;; \
      *) echo "Непідтримувана архітектура: $ARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /supercronic "https://github.com/aptible/supercronic/releases/download/v0.2.49/supercronic-linux-${ARCH}"; \
    echo "${SHA1}  /supercronic" | sha1sum -c -; \
    chmod +x /supercronic

# --- етап 2: runtime (без curl і без браузера) ---
FROM node:22.20.0-bookworm-slim
ARG APP_UID=1001
# Без інтерактивних питань debconf (tzdata) під час apt-get
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g "$APP_UID" app \
 && useradd -u "$APP_UID" -g app -M -d /app -s /usr/sbin/nologin app
COPY --from=supercronic /supercronic /usr/local/bin/supercronic
WORKDIR /app
ENV NODE_ENV=production \
    TZ=Europe/Kyiv
COPY package.json package-lock.json ./
# Без lifecycle-скриптів; перевірка під час збірки: нативний модуль impit завантажується
# і процес завершується сам (process.exit(0); timeout 60 — щоб збірка не зависла)
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
 && timeout 60 node -e "const {Impit}=require('impit');require('tough-cookie');new Impit({browser:'chrome'});console.log('impit OK');process.exit(0)"
COPY monitor.js daily-summary.js ./
COPY lib ./lib
COPY crontab ./crontab
# Директорія артефактів (volume), доступна для запису non-root користувачу
RUN supercronic -test /app/crontab \
 && mkdir -p /app/artifacts && chown app:app /app/artifacts
USER app
CMD ["supercronic", "/app/crontab"]
