# ♠ پوکر آنلاین دوستانه — Online Poker PWA

اپلیکیشن پیش‌رونده وب (PWA) برای بازی پوکر **تگزاس هولدم** به‌صورت آنلاین با دوستان.
بازی فقط با **ژتون** است (بدون پول واقعی) و حساب‌ها توسط **مدیر** کنترل می‌شوند.

A Progressive Web App for playing **Texas Hold'em** online with friends. Chips‑only
(no real money); accounts are managed by an admin. Built with **Next.js**, a custom
**Socket.IO** server, and **PostgreSQL**.

---

## قابلیت‌ها / Features

- **موتور سرور-محور (ضدتقلب):** شافل کارت‌ها با CSPRNG و درهم‌سازی Fisher–Yates روی سرور
  انجام می‌شود. کارت‌های هر بازیکن فقط برای خودش ارسال می‌شود؛ همه اقدام‌ها روی سرور
  اعتبارسنجی می‌شوند. برای هر دست یک *commitment* منتشر و seed پس از پایان برای بازبینی
  ذخیره می‌شود (provable fairness).
- **همزمانی زنده:** یک نمونهٔ بازی در حافظهٔ سرور برای هر میز، پخش وضعیت شخصی‌سازی‌شده به
  هر کلاینت، و تایمر «زمان فکر» با فولد/چک خودکار.
- **حساب و ژتون:** بانک ژتون هر بازیکن، دفتر کل (ledger) کامل با تاریخچه، و پرچم
  **تسویه‌شده/نشده** که مدیر تعیین می‌کند چه کسی به چه کسی پرداخته است.
- **تاپ‌آپ:** بازیکن سر میز درخواست افزایش ژتون می‌دهد؛ بسته به تنظیمات، مستقیم اعمال
  می‌شود یا در صف تأیید مدیر قرار می‌گیرد (حداقل/حداکثر قابل تنظیم).
- **تنظیمات میز و مدیر:** بلایند کوچک/بزرگ، آنته، درصد و سقف rake میز، حداقل/حداکثر ورود،
  زمان فکر هر نوبت، مجاز بودن تاپ‌آپ، و پیش‌فرض‌های سراسری.
- **پنل مدیریت:** مدیریت کاربران، شارژ/کسر ژتون، تأیید تاپ‌آپ‌ها، مشاهدهٔ تسویه‌ها، و
  تنظیمات سراسری.
- **PWA:** manifest + service worker، RTL فارسی، موبایل-محور، قابل نصب.
- **تورنومنت:** زیرساخت دیتابیس آماده است (فاز بعد).

---

## معماری / Architecture

```
Browser (PWA, React/Next client)
   │  HTTPS (REST: auth, lobby, admin)      WebSocket (/api/socket)
   ▼                                             ▼
Custom Node server (server.ts)  ──►  Next.js request handler (App Router)
   │                                             │
   ▼                                             ▼
Socket.IO handlers ──► GameManager (in-memory authority, 1 game/table)
                              │  HoldemGame engine (deck, evaluator, state machine)
                              ▼
                        PostgreSQL (users, ledger, hands+actions, topups, tables)
```

- `src/lib/poker/` — موتور خالص و مستقل پوکر (کارت‌ها، دک امن، ارزیاب دست، ماشین حالت).
- `src/server/` — GameManager و هندلرهای Socket.IO (منبع حقیقت زنده).
- `src/app/api/` — مسیرهای REST (احراز هویت، لابی، حساب، مدیریت).
- `src/app/` — رابط کاربری (لابی، میز زنده، حساب، پنل مدیر).
- `db/` — schema، مهاجرت (migration) و seed.

سرور با **esbuild** به یک باندل CJS تبدیل می‌شود تا Next بدون تداخل زیر یک سرور
سفارشی Socket.IO اجرا شود (به همراه polyfill سراسری `AsyncLocalStorage`).

---

## اجرای سریع با Docker (پیشنهادی) / One‑command Docker

تنها پیش‌نیاز: **Docker Desktop**. نیازی به نصب دستی Node یا Postgres نیست — دیتابیس،
مهاجرت و ساخت ادمین همه خودکار انجام می‌شود.

```bash
git clone https://github.com/vilanovax/vita.git poker
cd poker
git checkout claude/online-poker-pwa-2f19xn
docker compose up --build
```

سپس مرورگر را روی **http://localhost:3001** باز کنید و با `admin` / `admin1234` وارد شوید.
برای توقف: `docker compose down` (برای پاک‌کردن داده‌ها: `docker compose down -v`).

> رمز نشست: در محیط تولید حتماً `AUTH_SECRET` را ست کنید (مثلاً در یک فایل `.env`
> کنار `docker-compose.yml`). مقدار پیش‌فرض فقط برای توسعه است.

---

## راه‌اندازی دستی / Manual Setup

پیش‌نیاز: Node.js 20+ و PostgreSQL 14+.

```bash
# ۱) نصب وابستگی‌ها
npm install

# ۲) پیکربندی محیط
cp .env.example .env
# سپس DATABASE_URL و AUTH_SECRET را در .env تنظیم کنید
#   AUTH_SECRET را با: openssl rand -base64 48  بسازید

# ۳) ساخت جداول و ادمین پیش‌فرض
npm run db:migrate
npm run db:seed        # ادمین پیش‌فرض: admin / admin1234 (بعداً تغییر دهید)

# ۴) اجرای توسعه
npm run dev            # http://localhost:3000

# اجرای تولید
npm run build          # next build + باندل سرور
npm start
```

### متغیرهای محیطی

| متغیر | توضیح |
|------|-------|
| `DATABASE_URL` | رشتهٔ اتصال Postgres |
| `AUTH_SECRET` | کلید امضای JWT نشست (حداقل ۱۶ کاراکتر؛ توصیه ۳۲+) |
| `PORT` | پورت سرور (پیش‌فرض 3000) |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | اطلاعات ادمینِ seed |

---

## تست / Tests

```bash
npm test           # تست‌های واحد موتور پوکر (۴۶+ تست)
npm run test:e2e   # تست‌های E2E با Playwright (نیاز به اپ در حال اجرا)
```

برای E2E محلی ابتدا استک را بالا بیاورید (`docker compose up -d`) سپس:

```bash
npx playwright install chromium
npm run test:e2e
```

CI در GitHub Actions به‌صورت خودکار `npm test`، `lint`، `build` و E2E smoke را اجرا می‌کند.

---

## استقرار تولید / Production Deploy

### چک‌لیست

1. **رمزها:** `AUTH_SECRET` قوی (۳۲+ کاراکتر) و `SEED_ADMIN_PASSWORD` غیرپیش‌فرض
2. **فایل `.env`:** از `.env.example` کپی کنید و مقادیر را پر کنید
3. **TLS:** پشت reverse proxy (Caddy/nginx) با HTTPS
4. **پشتیبان‌گیری:** volume `pgdata` را منظم backup بگیرید
5. **تک‌نمونه:** فعلاً `GameManager` در حافظه است — برای scale افقی به Redis + sticky session نیاز دارید

### Docker تولید

```bash
# .env با AUTH_SECRET و SEED_ADMIN_PASSWORD
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

healthcheck: `GET /api/health` (بررسی اتصال دیتابیس)

### سلامت سرویس

```bash
curl http://localhost:3001/api/health
# → {"ok":true,"db":"ok"}
```

---

## نکات امنیتی / انصاف

- کارت‌ها هرگز به کلاینتی که مجاز به دیدنشان نیست ارسال نمی‌شوند (`publicState`).
- دک فقط روی سرور ساخته و شافل می‌شود؛ کلاینت هیچ کنترلی روی کارت‌ها ندارد.
- تمام اقدام‌ها (مبلغ‌ها، نوبت‌ها) روی سرور دوباره اعتبارسنجی و به موجودی واقعی محدود می‌شوند.
- کل تاریخچهٔ دست‌ها و اقدام‌ها برای داوری اختلاف ذخیره می‌شود (`hands`, `hand_actions`).

---

## نقشهٔ راه / Roadmap

- اجرای کامل تورنومنت (ساختار جداول آماده است): برنامهٔ بلایند، ادغام میزها، رتبه‌بندی.
- بازپخش دست و بازبینی provable-fairness در رابط کاربری.
- نشستن مجدد/جابه‌جایی صندلی، sit-out خودکار، و timebank.
- اعلان‌های Web Push برای نوبت بازیکن.
