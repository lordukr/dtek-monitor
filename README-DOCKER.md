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

Один контейнер `dtek-monitor` (образ Playwright + Node.js). Планувальник [supercronic](https://github.com/aptible/supercronic) (версія зафіксована в `Dockerfile`, перевіряється SHA1) працює всередині контейнера від імені non-root користувача `pwuser` і запускає завдання за файлом `crontab`. Docker socket не потрібен.

Розклад за замовчуванням (часовий пояс `Europe/Kyiv`, змінна `TZ`):

- `node monitor.js` - кожні 10 хвилин
- `node daily-summary.js` - щодня о 00:05

### Файли

- **Dockerfile** - образ з Playwright, supercronic і кодом (`monitor.js`, `daily-summary.js`, `lib/`)
- **crontab** - розклад завдань
- **docker-compose.yml** - опис сервісу
- **.dockerignore** - виключення файлів з образу
- **.env** - конфігурація (не комітиться)

## ⚙️ Налаштування

### Зміна розкладу

Відредагуйте файл `crontab` у корені проєкту, наприклад:

```cron
# Кожні 30 хвилин
*/30 * * * * cd /app && node monitor.js
```

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

# Версія Playwright
docker exec dtek-monitor npx playwright --version

# Перевірити, що supercronic працює
docker exec dtek-monitor ps aux | grep supercronic
```

Версія базового образу Playwright в `Dockerfile` має збігатися з версією `playwright` у `package-lock.json`.

## 📦 Збереження даних

Стан бота (`message-history.json`) зберігається в `./artifacts` через bind mount, тому не втрачається при перезапуску чи `docker compose down`. Файл не відстежується git: єдина копія - на хості, де працює контейнер (деплой через `deploy.yml` виключає `artifacts/` з rsync, тому не перезаписує і не видаляє її). Якщо файл зникне або пошкодиться, бот створить його заново після наступного сповіщення (можливе одне повторне повідомлення). Директорія має бути доступна для запису користувачу `pwuser` (uid 1001 в образі); на Linux перед першим запуском виконайте `mkdir -p artifacts && sudo chown -R 1001:1001 artifacts`.

## 🔄 Міграція з GitHub Actions

1. (Необов'язково) Щоб зберегти стан з часів GitHub Actions, відновіть файл з історії git (потрібен повний, не shallow, клон репозиторію): `mkdir -p artifacts && git show $(git rev-list -n 1 HEAD -- artifacts/message-history.json)^:artifacts/message-history.json > artifacts/message-history.json && sudo chown -R 1001:1001 artifacts`. Якщо Docker працює на іншому сервері, скопіюйте отриманий файл у `artifacts/` на сервері. Інакше файл буде створено автоматично після першого надісланого сповіщення.
2. Вимкніть GitHub Actions workflows (`monitor.yml`, `daily-summary.yml`), щоб не було дублювання повідомлень.
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

- Образ містить Chromium (~400MB), перша збірка може зайняти час.
- `.env` не повинен комітитися (вже в .gitignore).
