# DTEK Monitor - Project Context

## Project Overview
DTEK Monitor is an automated power outage monitoring system for DTEK (Ukrainian electricity provider) that sends notifications to Telegram when power outages are detected.

## Key Features
- Monitors DTEK website for power outages every 10 minutes (Docker on VPS, supercronic)
- Sends notifications to Telegram when outages are detected
- Sends separate messages per event: new outage, outage passed, outage cancelled, emergency outage
- Displays outage reason, start time, and expected restoration time
- Stores state in artifacts/message-history.json on the host where it runs (VPS bind mount); not tracked or committed to git

## Architecture

### Main Components
1. **monitor.js** - Main monitoring script
2. **daily-summary.js** - Daily morning summary (GitHub Actions 00:10 UTC; Docker 00:05 Kyiv)
3. **lib/** - Shared modules (`lib/dtek.js` DTEK scraping, `lib/telegram.js` Telegram API)
4. **GitHub Actions workflows** - Manual `workflow_dispatch` only (`monitor.yml`, `daily-summary.yml`); stateless there, so for testing only
5. **Docker** - Single container with supercronic scheduler (`crontab`, `Dockerfile`, `docker-compose.yml`)
6. **Telegram Bot** - Notification delivery
7. **Artifacts** - State persistence (`artifacts/message-history.json`, git-ignored, lives only where the bot runs; in production the VPS bind mount)
8. **scripts/** - Ad-hoc debug/preview scripts (hit the live site; not part of `npm test`)
9. **Tests** - `monitor.test.js`, `daily-summary.test.js`, `dtek.test.js` (run with `npm test`; required `npm test` check on every PR to `main` via `.github/workflows/test.yml`, merge blocked until it passes)

### Technology Stack
- Node.js 22 (see `.nvmrc`; engines `>=22`)
- impit (HTTP client with Chrome TLS fingerprint) + tough-cookie (cookie jar) for web scraping; no browser in production
- Playwright: devDependency used only by `scripts/` (run `npm install` and `npx playwright install chromium` first)
- dotenv (environment configuration)
- Telegram Bot API

## Environment Variables
- `TELEGRAM_BOT_TOKEN` - Bot token from BotFather
- `TELEGRAM_CHAT_ID` - Telegram chat ID for notifications
- `CITY` - City name in Cyrillic
- `STREET` - Street name in Cyrillic
- `HOUSE` - House number

**Note**: The .env file should be ignored in all operations per user request.

## Workflow
1. Script uses impit + tough-cookie (no browser) to fetch DTEK website data
2. Makes AJAX request with address details to get outage information
3. Checks if there's an active power outage (emergency = `#modal-attention` popup block containing the stem `екстрен`, case-insensitive)
4. If outage detected, sends/updates Telegram notification
5. Saves message history to artifacts/message-history.json (local only, not committed)

## Important Files
- `monitor.js` - Main monitoring logic
- `.github/workflows/monitor.yml` - CI/CD workflow
- `daily-summary.js`, `lib/` - Daily summary and shared modules
- `artifacts/message-history.json` - Stores last sent message (state); git-ignored, exists only where the bot runs
- `scripts/` - Debug/preview scripts
- `monitor.test.js`, `daily-summary.test.js`, `dtek.test.js` - Tests
- `crontab`, `Dockerfile`, `docker-compose.yml` - Docker deployment
- `package.json` - Dependencies and project metadata
- `.env.example` - Environment variables template

## Development Notes
- The project scrapes DTEK website: https://www.dtek-krem.com.ua/ua/shutdowns
- Uses CSRF token from page for AJAX requests
- Implements message deduplication via message history (separate message per event type)
- Automatic retry on notification failures
