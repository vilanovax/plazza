-- Admin-tunable defaults for sit-out and time-bank behaviour.
ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS sit_out_max_min    INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS extra_time_sec     INT NOT NULL DEFAULT 15,
  -- Extra-time requests allowed per player per hand: -1 = unlimited, 0 = off.
  ADD COLUMN IF NOT EXISTS extra_time_requests INT NOT NULL DEFAULT -1;
