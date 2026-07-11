# معماری پایگاه‌داده (PostgreSQL)

سند مرجع برای schema، یکپارچگی، partitioning و WAL/بازیابی در plazza.

قرارداد پایه:

- **کلید اصلی:** `UUID` برای موجودیت‌ها؛ `BIGSERIAL` برای جدول‌های append-only (لاگ/رویداد).
- **پول:** `BIGINT` با کران `CHECK (>= 0)` و `CHECK (<= 9007199254740991)` (کف/سقفِ عدد صحیحِ امن).
- **زمان:** `TIMESTAMPTZ`.
- علامت‌گذاری: ✅ موجود در schema فعلی · 🆕 پیشنهاد جدید.

---

## ۱) جدول‌ها

### هویت و اجتماع

| جدول | وضعیت | PK | ارتباط‌ها / Index کلیدی |
|------|-------|----|--------------------------|
| `users` | ✅ | `id UUID` | `chip_balance BIGINT CHECK(>=0)`؛ `UNIQUE(username)`, `UNIQUE(lower(email))` |
| `user_devices` | 🆕 | `id UUID` | FK `user_id → users ON DELETE CASCADE`؛ `UNIQUE(user_id, device_fingerprint)`؛ Index `(user_id)`, `(last_seen_at)` — سیگنال ضدتقلب + push token |
| `user_sessions` | 🆕 | `id UUID` | FK `user_id`, `device_id`؛ `UNIQUE(refresh_token_hash)`؛ Index `(user_id)`, `(expires_at)` — فقط hash توکن، نه خودش (plazza فعلاً JWT بی‌حالت دارد؛ فقط اگر ابطال سمت‌سرور خواستید) |
| `friendships` | 🆕 | `(low_user_id, high_user_id)` | FK هر دو `→ users`؛ `CHECK(a<>b)`؛ Index معکوس `(high_user_id)` — جفت مرتب‌شده تا تکراری نشود |
| `blocks` (`user_blocks`) | ✅ | `(blocker_id, blocked_id)` | `CHECK(blocker<>blocked)`؛ Index روی `blocked_id` (برای cascade معکوس) |
| `clubs` | 🆕 | `id UUID` | FK `owner_id → users`؛ `UNIQUE(slug)`؛ Index `(owner_id)` |
| `club_members` | 🆕 | `(club_id, user_id)` | FK هر دو `ON DELETE CASCADE`؛ `role`؛ Index معکوس `(user_id)` |

### میز و بازی

| جدول | وضعیت | PK | ارتباط‌ها / Index کلیدی |
|------|-------|----|--------------------------|
| `tables` (`poker_tables`) | ✅ | `id UUID` | `config JSONB`؛ Index `(status, created_at)` برای Lobby |
| `table_seats` | ✅ | `(table_id, seat_index)` | FK `table_id`, `user_id`؛ `UNIQUE(table_id, user_id) WHERE user_id IS NOT NULL`؛ Index معکوس `(user_id)` |
| `table_members` | 🆕 | `(table_id, user_id)` | تمایز «حاضر در اتاق» از «نشسته»؛ فقط اگر تماشاگر/چت دارید — وگرنه `table_seats` کافی است |
| `games` | 🆕 | `id UUID` | لایهٔ «نشست میز» بالای `hands` (rake تجمیعی)؛ برای پوکر معمولاً لازم نیست |
| `hands` | ✅ | `id` | FK `table_id`؛ `hand_no`, `button_seat`, `deck_commitment`, `deck_seed`, `rake`؛ Index `(table_id, hand_no)`, `(table_id, ended_at DESC)` |
| `hand_players` | ✅ | `(hand_id, seat_index)` | FK `hand_id ON DELETE CASCADE`, `user_id`؛ `hole_cards`, `starting_stack`, `net_result`؛ Index معکوس `(user_id, hand_id)` |
| `player_actions` (`hand_actions`) | ✅ | `BIGSERIAL` | FK `hand_id ON DELETE CASCADE`؛ `street`, `action_type`, `amount`, `action_seq`؛ Index `(hand_id, action_seq)` |
| `pots` | 🆕 | `BIGSERIAL` | FK `hand_id`؛ `pot_index`, `amount`, `eligible_seats INT[]`, `winner_seat` — فقط اگر کوئری تحلیلی روی side-pot خواستید؛ وگرنه در `HandResult` JSONB بماند |
| `game_events` | ✅ | `BIGSERIAL` | append-only هش‌زنجیره‌ای؛ `UNIQUE(table_id, sequence)`, `UNIQUE(table_id, action_id) WHERE action_id IS NOT NULL`؛ Index `(table_id, sequence)` |
| `game_snapshots` | ✅ | `BIGSERIAL` | FK `table_id`؛ `UNIQUE(table_id, sequence)`؛ لنگر بازیابی |

### پول

| جدول | وضعیت | PK | ارتباط‌ها / Index کلیدی |
|------|-------|----|--------------------------|
| `chip_ledger` (`ledger_entries`) | ✅ | `BIGSERIAL` | **منبع حقیقتِ پول، append-only**؛ FK `user_id`؛ `delta BIGINT`, `reason`, `ref_type/ref_id`, `balance_after`؛ `UNIQUE(idempotency_key)`؛ Index `(user_id, id DESC)`؛ trigger ضدِ UPDATE/DELETE |

`users.chip_balance` باید **cacheِ مشتق** باشد، نه مرجع (بخش ۲).

### دعوت / تورنومنت / تخلف / امنیت

| جدول | وضعیت | PK | ارتباط‌ها / Index کلیدی |
|------|-------|----|--------------------------|
| `invites` | 🆕 | `id UUID` | `UNIQUE(code)`؛ FK `table_id`/`club_id`, `inviter_id`؛ `expires_at`, `max_uses`, `used_count` |
| `tournaments` | ✅ | `id UUID` | `buy_in_chips`, `starting_stack`, `prize_pool` با CHECK nonneg/max |
| `tournament_entries` | ✅ | `(tournament_id, user_id)` | `chips`, `prize` با CHECK nonneg |
| `reports` (`user_reports`) | ✅ | `BIGSERIAL` | FK `reporter → SET NULL`, `reported → CASCADE`؛ `status`؛ `CHECK not-self` |
| `moderation_actions` | 🆕 | `BIGSERIAL` | FK `moderator_id`, `target_user_id`, `report_id?`؛ `action`, `reason`, `expires_at?`؛ Index `(target_user_id, created_at DESC)` |
| `audit_logs` (`audit_log`) | ✅ | `BIGSERIAL` | append-only با trigger؛ Index روی actor/action/correlation/created |
| `security_signals` | 🆕 | `BIGSERIAL` | `subject_user_id`, `signal_type`, `score`, `context JSONB`؛ Index `(subject_user_id, created_at DESC)`, `(signal_type)` — ضدتبانی/chip-dumping |
| `idempotency_keys` | 🆕 | `key TEXT` | `user_id`, `outcome JSONB`, `status`, `expires_at`؛ Index `(expires_at)` — plazza فعلاً درون‌حافظه‌ای (`Map`) است؛ پیش‌نیاز چند-instance |

---

## ۲) تراکنش و یکپارچگی

| مورد | توصیه |
|------|-------|
| **Foreign Keys** | داده‌ی وابسته به موجودیت زنده → `ON DELETE CASCADE`؛ داده‌ی تاریخی/ممیزی که باید بعد از حذف کاربر بماند → `ON DELETE SET NULL` یا بدون FK (مثل `audit_log.actor_id`, `reports.reporter`) |
| **Unique** | `users(username)`, `lower(email)`؛ `table_seats(table_id,user_id)` جزئی؛ `ledger(idempotency_key)`؛ `game_events(table_id, sequence)` و `(action_id)` جزئی؛ `invites(code)` |
| **Check** | پول `>=0` و `<=2^53-1`؛ `blocker<>blocked`, `reporter<>reported`؛ `friendship a<>b`؛ enumها با CHECK/نوع enum |
| **Transaction Boundary** | یک تراکنش = یک تغییرِ منطقیِ اتمی. قاعده: **هر تغییر state + رکورد ممیزی/پولِ آن در یک `tx()`** (مثل resolve+audit، ban+audit، hand-result+stats) |
| **Row-Level Lock** | mutate موجودی: `SELECT ... FOR UPDATE` سپس درج ledger + به‌روزرسانی cache — مانع lost-update |
| **Optimistic Locking** | برای stateهای پرخوانش/کم‌تعارض: `UPDATE ... WHERE version=$expected`، شکست ⇒ retry (مثل `GameState.version`) |
| **Advisory Lock** | ترتیب سریال بدون ردیفِ قابل‌قفل — مثل allocationِ `sequence` در `appendEvent` با `pg_advisory_xact_lock(hashtext(table_id))` |
| **Ledger دوطرفه/Immutable** | انتقال چیپ = دو (یا چند) ردیف ledger با **Σdelta = 0** در یک تراکنش؛ ledger فقط append |
| **جلوگیری از Balance منفی** | دو لایه: `CHECK(chip_balance >= 0)` (DB خودش reject/rollback) + اعتبارسنجی منطقی قبل از debit |
| **عدم Update مستقیم Balance** | هیچ `UPDATE users SET chip_balance = ...` مستقیمی جز از مسیر `postLedger(tx, userId, delta, ref)`؛ اختیاری: trigger روی users که UPDATEِ بدون ردیف ledger متناظر را رد کند |

الگوی مرجع (انتقال چیپ — اتمی، immutable، ضدمنفی، بدون deadlock):

```sql
BEGIN;
  -- همیشه به ترتیب ثابتِ id قفل بگیر تا deadlock نشود
  SELECT chip_balance FROM users WHERE id = LEAST($loser,$winner)  FOR UPDATE;
  SELECT chip_balance FROM users WHERE id = GREATEST($loser,$winner) FOR UPDATE;
  INSERT INTO ledger_entries(user_id, delta, reason, ref_type, ref_id, idempotency_key)
    VALUES ($loser,  -$amt, 'hand_settle', 'hand', $handId, $key),
           ($winner, +$amt, 'hand_settle', 'hand', $handId, $key);   -- Σdelta = 0
  UPDATE users SET chip_balance = chip_balance - $amt WHERE id = $loser;    -- CHECK >=0 محافظ
  UPDATE users SET chip_balance = chip_balance + $amt WHERE id = $winner;
COMMIT;
```

---

## ۳) Partitioning و Retention

| جدول | Partition | چرا |
|------|-----------|-----|
| `game_events` | RANGE بر `created_at` (ماهانه) | append-only پرحجم؛ آرشیو/حذف با `DROP PARTITION` فوری |
| `audit_log` | RANGE ماهانه | همان + الزام نگهداری قانونی |
| `hands` / `hand_actions` / `hand_players` | RANGE ماهانه (بر پایان دست) | رشد خطی با حجم بازی |
| `ledger_entries` | RANGE ماهانه، **retention نامحدود** | داده‌ی مالی؛ partition فقط برای کارایی |
| `security_signals`, `table_events` | RANGE ماهانه | داغ کوتاه، سرد بلند |

- ابزار: **`pg_partman`** برای مدیریت خودکار partition + retention.
- Index مناسبِ append-only زمانی: **BRIN روی `created_at`** (ارزان) در کنار/به‌جای B-tree.

**مدت نگهداری و آرشیو:**

- `ledger_entries` — برای همیشه در DB (منبع حقیقتِ پول).
- `audit_log` — داغ ۱۲–۲۴ ماه در DB (طبق الزام حوزهٔ پولی)، سپس آرشیو به Object Storage؛ حذف نشود.
- `game_events` / `hand_actions` — داغ ۳–۶ ماه برای بازپخش/دعاوی؛ سپس آرشیو partitionهای قدیمی (Parquet/جریان رویداد) و `DROP PARTITION`.
- زمان آرشیو: وقتی partition کاملاً «سرد» شد (هیچ دستِ فعالی به آن ماه اشاره نمی‌کند) — معمولاً ماهِ ۲+ قبل.

**Sharding:**

- **زودهنگام نه.** ترتیب: (۱) Index/کوئریِ بهینه → (۲) partitioning زمانی → (۳) read-replica برای بار خواندن/Analytics → (۴) فقط اگر یک instance جواب نداد، sharding.
- کِی لازم می‌شود: نرخ نوشتنِ یک جدول داغ (`game_events`) از ظرفیت یک primary عبور کند، یا دیتاست فعال از یک node بزرگ‌تر شود.
- کلید طبیعیِ shard = **`table_id`** (هر میز مستقل ⇒ بدون join بین‌shard).

---

## ۴) WAL / پشتیبان‌گیری / بازیابی

| مورد | توصیه |
|------|-------|
| **WAL Archiving** | `archive_mode=on` + ابزار **pgBackRest**/**WAL-G** که WAL را پیوسته به Object Storage می‌فرستد — پایهٔ PITR |
| **Point-in-Time Recovery** | base backup روزانه + WALِ پیوسته ⇒ بازیابی تا هر لحظه (مثلاً «۳۰ ثانیه قبل از حادثهٔ پولی») |
| **Replication Slot** | برای standby از slot استفاده کن تا primary زودتر WAL را حذف نکند؛ اما slotِ عقب‌مانده خطرِ اصلیِ پرشدن دیسک است |
| **WAL Retention** | `max_slot_wal_keep_size` را ست کن تا یک slotِ مرده کل DB را متوقف نکند (trade-off: آن replica rebuild می‌شود)؛ `wal_keep_size` معقول برای reconnect کوتاه |
| **خطر پر شدن Disk** | سه علت: slotِ متوقف، `archive_command`ِ fail، long-running transaction. هر سه را مانیتور کن؛ دیسکِ WAL جدا از دیتا اگر ممکن است |
| **Monitoring Lag** | `pg_stat_replication` (write/flush/replay_lag)، `pg_replication_slots.restart_lsn`، `pg_stat_archiver.last_failed_time`؛ هشدار روی lag و شکستِ archive |
| **Backup Validation** | بکاپِ تأییدنشده = بکاپ ندارید. checksum + **restore واقعی به instance موقت** + کوئری صحت (مثلاً `SUM(delta) از ledger == مجموع chip_balance`) |
| **Restore Drill** | تمرینِ دوره‌ای (ماهانه/فصلی): PITR کامل، اندازه‌گیری RTO/RPO و مستندسازی — اولین restoreِ واقعی نباید وسط حادثه باشد |

هدف پیشنهادی برای بازی پولی: **RPO ≈ چند ثانیه** (WAL پیوسته) و **RTO مشخص و تمرین‌شده**.

---

## شکاف‌های اصلی تا این طرح

1. **`ledger` را منبعِ حقیقتِ پول کن** و balance را فقط از مسیر ledger به‌روز کن (بستنِ هر UPDATE مستقیم).
2. **idempotency و session/presence را از حافظه به DB/Redis ببر** (پیش‌نیاز چند-instance).
3. **partitioning زمانی + WAL archiving/PITR + restore drill** را عملیاتی کن.
