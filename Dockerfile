# Версія образу має збігатися з версією playwright у package-lock.json (1.56.1)
FROM mcr.microsoft.com/playwright:v1.56.1-noble

# supercronic: планувальник усередині контейнера (без docker.sock).
# Версія та SHA1 взяті з офіційних release notes:
# https://github.com/aptible/supercronic/releases/tag/v0.2.49
ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA1SUM_AMD64=e63c11a9726b775a6a11801e81af4f3fb926aa68
ARG SUPERCRONIC_SHA1SUM_ARM64=0b6c5bb743e0b0dafed1132198c81807927ac413

RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) SHA="${SUPERCRONIC_SHA1SUM_AMD64}" ;; \
      arm64) SHA="${SUPERCRONIC_SHA1SUM_ARM64}" ;; \
      *) echo "Unsupported arch: ${TARGETARCH}"; exit 1 ;; \
    esac; \
    FILE="supercronic-linux-${TARGETARCH:-amd64}"; \
    curl -fsSL -o "/tmp/${FILE}" "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/${FILE}"; \
    echo "${SHA}  /tmp/${FILE}" | sha1sum -c -; \
    install -m 0755 "/tmp/${FILE}" /usr/local/bin/supercronic; \
    rm "/tmp/${FILE}"

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY monitor.js daily-summary.js ./
COPY lib ./lib
COPY crontab ./crontab

# Директорія артефактів (volume), доступна для запису non-root користувачу
RUN mkdir -p artifacts && chown -R pwuser:pwuser /app

ENV NODE_ENV=production \
    TZ=Europe/Kyiv

USER pwuser

CMD ["supercronic", "/app/crontab"]
