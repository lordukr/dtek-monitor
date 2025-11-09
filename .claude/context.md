# DTEK Monitor - Project Context

## Project Overview
DTEK Monitor is an automated power outage monitoring system for DTEK (Ukrainian electricity provider) that sends notifications to Telegram when power outages are detected.

## Key Features
- Monitors DTEK website for power outages every 10 minutes via GitHub Actions
- Sends notifications to Telegram when outages are detected
- Updates existing messages instead of creating new ones (one message per day)
- Displays outage reason, start time, and expected restoration time
- Stores state in artifacts committed to repository

## Architecture

### Main Components
1. **monitor.js** - Main monitoring script
2. **GitHub Actions workflow** - Automated execution every 10 minutes
3. **Telegram Bot** - Notification delivery
4. **Artifacts** - State persistence (last-message.json)

### Technology Stack
- Node.js (v20.19.0+)
- Playwright (for web scraping)
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
1. Script uses Playwright to fetch DTEK website data
2. Makes AJAX request with address details to get outage information
3. Checks if there's an active power outage
4. If outage detected, sends/updates Telegram notification
5. Saves message metadata to artifacts/last-message.json
6. GitHub Actions commits artifacts back to repository

## Important Files
- `monitor.js` - Main monitoring logic
- `.github/workflows/monitor.yml` - CI/CD workflow
- `artifacts/last-message.json` - Stores last message metadata
- `package.json` - Dependencies and project metadata
- `.env.example` - Environment variables template

## Development Notes
- The project scrapes DTEK website: https://www.dtek-krem.com.ua/ua/shutdowns
- Uses CSRF token from page for AJAX requests
- Implements message deduplication (one message per day)
- Automatic retry on notification failures
