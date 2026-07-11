# امکانات و اقدامات پیاده‌سازی‌شده — Plazza

این سند تمام قابلیت‌های موجود سیستم و کارهای انجام‌شده روی برنچ
`claude/app-booker-online-review-zudqbf` را مستند می‌کند.

راهنما: ✅ کامل · 🟡 جزئی/ضمنی · ❌ ندارد

---

## بخش ۱ — قابلیت‌های هستهٔ سیستم (موجود)

### 🎮 هستهٔ بازی
| قابلیت | وضعیت | محل |
|--------|:---:|-----|
| موتور بازی سرور-محور (منبع حقیقت) | ✅ | `src/lib/poker/engine.ts` |
| مراحل Pre-Flop/Flop/Turn/River/Showdown | ✅ | `engine.ts` (`GamePhase`) |
| Dealer / Small Blind / Big Blind + heads-up | ✅ | `engine.ts` (`postBlind`) |
| اعتبارسنجی Fold/Check/Call/Bet/Raise/All-in | ✅ | `engine.ts` (`act`, `applyAggressive`) |
| محاسبهٔ Pot و Side Pot لایه‌ای | ✅ | `engine.ts` (`buildSidePots`) |
| Split Pot و Tie (چیپ فرد به نزدیک‌ترین صندلی چپ باتن) | ✅ | `engine.ts` (`settle`) |
| ارزیابی دقیق دست (Hand Evaluation) | ✅ | `src/lib/poker/evaluator.ts` |
| Timeout بازیکن + Auto-Fold/Auto-Check | ✅ | `engine.ts` (`timeout`) |
| خروج بازیکن وسط دست | ✅ | `engine.ts` (`leave`, `pendingLeave`) |
| State Machine مشخص دست/میز | ✅ | `engine.ts` (`phase`) |

### 🔐 امنیت شافل (Provably Fair)
| قابلیت | وضعیت | محل |
|--------|:---:|-----|
| CSPRNG (randomBytes + HMAC-SHA256 DRBG) | ✅ | `src/lib/poker/deck.ts` |
| شافل فقط روی سرور | ✅ | `deck.ts` |
| جلوگیری از دیدن Deck توسط کلاینت | ✅ | `engine.ts` (`publicState`) |
| Commitment قبل از دست + افشای seed پس از دست | ✅ | `deck.ts` |
| ممیزی مستقل شافل | ✅ | `deck.ts` (`verifyDeck`) |

### 🕹️ حالت‌های بازی
| حالت | وضعیت |
|------|:---:|
| Cash Game با چیپ مجازی | ✅ |
| Heads-Up (۲ نفره) | ✅ |
| Tournament تک‌میزه | ✅ |
| Blind Structure + افزایش خودکار | ✅ |
| Rebuy | ✅ |

### 🏠 اتاق و بازیکن
| قابلیت | وضعیت |
|--------|:---:|
| ایجاد/ورود/خروج میز، Seat Management، ظرفیت | ✅ |
| Host Controls (نقش admin) + Kick | ✅ |
| مدیریت AFK (sit-out + حذف خودکار) | ✅ |
| reconnect / resume بعد از restart | ✅ |

### 👤 هویت و UI
| قابلیت | وضعیت |
|--------|:---:|
| ثبت‌نام/ورود (username+password، bcrypt، JWT) | ✅ |
| Lobby + فهرست میزها + ساخت میز | ✅ |
| صفحهٔ میز: Pot/Stack/Timer/Action Controls/وضعیت اتصال/خطاها | ✅ |
| تنظیمات صدا (mute) | ✅ |
| Accessibility پایه (aria-live، focus trap) | ✅ |
| Mobile Responsive (compact/landscape) | ✅ |
| پروفایل: آواتار، پشت کارت، رنگ چیپ، عنوان/شعار، کارت‌های محبوب، ایموجی | ✅ |
| آمار عملکرد (win rate، دست‌ها، بزرگ‌ترین برد، net، بهترین دست) | ✅ |

---

## بخش ۲ — کارهای انجام‌شده در این نشست (۲۱ کامیت)

### ⚡ بهینه‌سازی UI و کیفیت کد
- **رندر میز زنده:** فعال‌سازی واقعی `memo` روی `SeatView` با تابع مقایسهٔ فیلد-به-فیلد، پایدارسازی `onSelect`، memoize کردن `evaluate` و فیلتر چت. (`1047db6`, `1583f36`)
- **رفع کامل خطاهای lint** موجود (prefer-const، unused var، setState-in-effect). (`5ad60ca`)
- **رفع تست‌های e2e** با ابهام selector (strict-mode). (`a351739`)

### 🔒 امنیت و یکپارچگی مالی
- **Rate-limit روی ثبت‌نام** (۱۰/ساعت/IP) + سخت‌سازی منبع IP (راست‌ترین XFF پشت proxy). (`acbbead`, `8c20d77`)
- **Idempotency واقعی تاپ‌آپ:** `requestId` پایدار سمت کلاینت + store کش-نتیجه در سرور (exactly-once)، پایداری id تا دریافت ack، نمایش نتیجه به کاربر، ارسال به room کاربر برای reconnect. (`21df332`, `5f04f06`, `a748f9a`, `f1fa0e2`)

### 🚪 میز خصوصی
- **میز invite-only:** ستون‌های `is_private`/`invite_code`، حذف از لابی عمومی، گیت دسترسی سوکت (join/sit)، لینک دعوت قابل‌کپی. (`dfe2a3f`)

### 📋 لاگ و ممیزی (Audit)
- **جدول `audit_log` append-only** (trigger ضدِ UPDATE/DELETE) + Correlation ID: ثبت login/logout/register و عملیات ادمین (credit/debit، فعال‌سازی کاربر، تنظیمات، تصمیم تاپ‌آپ). audit مالی و ban **اتمیک** با تغییر state. (`d0d0895`, `f1fa0e2`)
- **persist فید رویداد میز** (جدول `table_events`) — بعد از restart بازیابی می‌شود. (`b605caa`)
- **تست invariant حفظ ژتون** (stacks+pot=start حین دست، stacks+rake=start بعد از settle). (`169abe9`)
- **ایندکس‌های جست‌وجوی audit** (CONCURRENTLY) + پشتیبانی runner از migration بدون transaction. (`449c8c7`, `49d09e7`)

### 🔄 قابلیت‌های جدید بازی
- **Sequence Number** روی broadcast — کلاینت state کهنه/بی‌ترتیب را رد می‌کند. (`38eb32c`)
- **Ban میز** (منع دائمی، مکمل kick) با گیت join/sit و audit اتمیک. (`f6102d8`, `8c1af8e`)
- **Sit & Go auto-start** با پرشدن ظرفیت + guard ضدِ double-start. (`952f21f`, `8c1af8e`)
- **Ready State** برای دست اول میز کش (گیت آماده‌بودن ≥۲ نفر). (`d57c6d6`)

### مهاجرت‌های دیتابیس افزوده‌شده
`0016_private_tables` · `0017_audit_log` · `0018_table_events` · `0019_audit_search_indexes` · `0020_table_bans`

---

## بخش ۳ — راستی‌آزمایی
هر تغییر با این چک‌ها تأیید شده: **eslint پاک**، **next build (TypeScript پاس)**، **۵۶/۵۶ تست واحد** (شامل تست‌های جدید invariant و ready gate). همهٔ کامنت‌های ری‌ویو خودکار (cubic) در چند دور رسیدگی و resolve شده‌اند.
