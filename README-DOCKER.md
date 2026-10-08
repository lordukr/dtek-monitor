# 🐳 DTEK Monitor - Docker Setup

Запуск DTEK Monitor у Docker контейнері замість GitHub Actions.

## 📋 Переваги Docker

- ✅ Повний контроль над середовищем виконання
- ✅ Можливість запуску на власному сервері/комп'ютері
- ✅ Незалежність від обмежень GitHub Actions
- ✅ Збереження стану в локальних файлах
- ✅ Легке налаштування розкладу виконання

## 🚀 Швидкий старт

### Вимоги

- Docker
- Docker Compose
- Файл `.env` з налаштуваннями

### 1. Створення `.env` файлу

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-12346789
CITY=Васюківка
STREET=Перемоги
HOUSE=1
```

### 2. Запуск

```bash
# Збудувати та запустити контейнер
docker compose up -d --build

# Переглянути логи
docker compose logs -f
```

### 3. Зупинка

```bash
docker compose down
```

## 🏗️ Архітектура

Один контейнер `dtek-monitor` (образ на базі `node:22.20.0-bookworm-slim` + Node.js, без браузера). Планувальник [supercronic](https://github.com/aptible/supercronic) (версія зафіксована в `Dockerfile`, перевіряється SHA1) працює всередині контейнера від імені non-root користувача `app` (uid 1001) і запускає завдання за файлом `crontab`. Docker socket не потрібен.

Отримання даних ДТЕК виконується через `impit` (HTTP-клієнт з TLS-відбитком Chrome) і `tough-cookie` (cookie jar) без браузера. Образ не містить браузера.

Розклад за замовчуванням (часовий пояс `Europe/Kyiv`, змінна `TZ`):

- `node monitor.js` - кожні 10 хвилин
- `node daily-summary.js` - щодня о 00:05

Обидва завдання запускаються з обмеженням часу: `cd /app && timeout -k 10 240 node <скрипт>.js` (після 240 с процес отримує SIGTERM, через 10 с - SIGKILL).

### Файли

- **Dockerfile** - образ на базі `node:22.20.0-bookworm-slim`, supercronic і кодом (`monitor.js`, `daily-summary.js`, `lib/`)
- **crontab** - розклад завдань
- **docker-compose.yml** - опис сервісу
- **.dockerignore** - виключення файлів з образу
- **.env** - конфігурація (не комітиться)

### Dev-залежності для scripts/

Скрипти в `scripts/` використовують Playwright (devDependency) і виконуються лише локально, не в образі. Для них потрібні `npm install` і:

```bash
npx playwright install chromium
```

## ⚙️ Налаштування

### Зміна розкладу

Відредагуйте файл `crontab` у корені проєкту, наприклад:

```cron
# Кожні 30 хвилин
*/30 * * * * cd /app && timeout -k 10 240 node monitor.js
```

Зберігайте обгортку `timeout -k 10 240` при зміні розкладу: вона обмежує тривалість кожного запуску.

Файл копіюється в образ, тому потрібно перебудувати контейнер:

```bash
docker compose up -d --build
```

### Ручний запуск

```bash
docker exec dtek-monitor node monitor.js
docker exec dtek-monitor node daily-summary.js
```

## 📊 Логи та стан

```bash
docker compose ps
docker compose logs --tail=50 -f

# Стан бота (останнє надіслане повідомлення; лише на хості, не в git)
cat artifacts/message-history.json
```

## 🔧 Корисні команди

```bash
# Перебудувати образ після змін коду
docker compose up -d --build

# Зайти в контейнер
docker exec -it dtek-monitor /bin/bash

# Перезапустити
docker compose restart
```

## 🐛 Налагодження

```bash
# Збірка без кешу
docker compose build --no-cache

# Перевірити, що impit завантажується
docker exec dtek-monitor node -e "require('impit');console.log('impit OK')"

# Перевірити, що supercronic працює
docker exec dtek-monitor ps aux | grep supercronic
```

### Помилки «Getting info failed»

Якщо отримання даних не вдалося, у логах з'являється рядок `Getting info failed: <причина>`. Знайти їх:

```bash
docker logs dtek-monitor 2>&1 | grep 'Getting info failed'
```

| Причина (префікс) | Що означає | Дія |
|---|---|---|
| `Blocked by Incapsula` | Imperva заблокувала impit (IP або відбиток клієнта) | Якщо повторюється кілька запусків поспіль, виконайте відкат (див. нижче) |
| `Page GET failed: HTTP` | Сторінка ДТЕК повернула помилку HTTP | Тимчасово: наступний запуск повторить спробу. Якщо триває, перевірте сайт у браузері |
| `Page GET returned oversized body` | Відповідь сторінки завелика (можлива заглушка або технічне обслуговування) | Тимчасово: наступний запуск повторить спробу. Якщо триває, перевірте сайт у браузері |
| `CSRF token not found` | Розмітка сторінки змінилася або це заглушка (назва сторінки є в тексті повідомлення) | Потрібне оновлення коду |
| `AJAX POST failed: HTTP` | 400: токен або cookie відхилено; 5xx: проблема на боці сайту | Якщо триває, це зміна сайту або API: потрібне оновлення коду |
| `AJAX POST returned non-JSON` | API змінився, відповідь не є JSON | Потрібне оновлення коду |
| `timed out after` | Запит перевищив ліміт 30 с | Тимчасово: наступний запуск повторить спробу |
| `network error` | Мережева помилка | Тимчасово: наступний запуск повторить спробу |

Код виходу **124** (або 137, якщо знадобився SIGKILL після `-k 10`) означає, що таймаут 240 с (`timeout -k 10 240`) зупинив завдання cron.

Відкат: `git revert -m 1 <merge-sha>` на `main` (відміна merge-коміту) з push; після деплою образ знову збирається з Playwright, а користувач контейнера знову `pwuser` (uid 1001 у тому образі).

## 📦 Збереження даних

Стан бота (`message-history.json`) зберігається в `./artifacts` через bind mount, тому не втрачається при перезапуску чи `docker compose down`. Файл не відстежується git: єдина копія - на хості, де працює контейнер (деплой через `deploy.yml` виключає `artifacts/` з rsync, тому не перезаписує і не видаляє її). Якщо файл зникне або пошкодиться, бот створить його заново під час наступного успішного запуску; при цьому можливе одне повторне сповіщення, а повідомлення «відключення минуло» / «відключення скасовано» для поточного відключення може не надійти. Директорія має бути доступна для запису користувачу контейнера `app` (uid 1001); на Linux перед першим запуском виконайте `mkdir -p artifacts && sudo chown -R 1001:1001 artifacts`. Якщо сервер оновлюється через `git pull` (а не через `deploy.yml`), перед оновленням до цієї версії збережіть копію `artifacts/message-history.json`: git видалить файл, бо він більше не відстежується. Після оновлення поверніть файл на місце і виконайте `sudo chown 1001:1001 artifacts/message-history.json`.

**Міграція власника (на VPS, до злиття PR):** перевірте власника командою `ls -n artifacts`. Якщо власник не 1001, виконайте `sudo chown -R 1001:1001 artifacts`.

## 🔄 Міграція з GitHub Actions

1. Вимкніть GitHub Actions workflows (`monitor.yml`, `daily-summary.yml`), щоб не було дублювання повідомлень.
2. (Необов'язково) Перенесіть стан. Це має сенс, лише якщо workflow працював нещодавно: застарілий стан може спричинити хибне повідомлення «відключення минуло», тож якщо сумніваєтесь, пропустіть цей крок. У локальному повному (не shallow) клоні вашого репозиторію виконайте `git pull`, потім `git log -n 1 --diff-filter=AM --format=%h -- artifacts/message-history.json` - команда покаже коміт з останньою збереженою версією; збережіть її: `git show <коміт>:artifacts/message-history.json > message-history.json`. Скопіюйте файл на сервер у `artifacts/` директорії проєкту (наприклад, `scp message-history.json <сервер>:<директорія-проєкту>/artifacts/`) і на сервері в директорії проєкту виконайте `sudo chown 1001:1001 artifacts/message-history.json`, інакше бот не зможе оновлювати файл. Якщо пропустити цей крок, файл буде створено автоматично під час першого запуску.
3. Запустіть Docker setup.

## 🆚 Порівняння з GitHub Actions

| Аспект | GitHub Actions | Docker |
|--------|---------------|--------|
| Хостинг | Сервери GitHub | Ваш сервер |
| Вартість | Безкоштовно | Ресурси вашого сервера |
| Точність розкладу | Cron може запізнюватись | Точно за crontab |
| Налаштування | Через secrets | Через .env |
| Стан | Не зберігається між запусками | Локальний файл (bind mount) |

## 📝 Примітки

- Образ slim (`node:22.20.0-bookworm-slim`) без браузера, тому перша збірка займає менше часу.
- `.env` не повинен комітитися (вже в .gitignore).
