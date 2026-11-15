ALTER TABLE "users"
  ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMPTZ(3);

ALTER TABLE "subscription_plans"
  ADD COLUMN "max_devices_per_user" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "device_restriction_enabled" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "organization_subscription_plan_overrides"
  ADD COLUMN "max_devices_per_user" INTEGER,
  ADD COLUMN "device_restriction_enabled" BOOLEAN;

ALTER TABLE "sessions"
  ADD COLUMN "device_hash" CHAR(64),
  ADD COLUMN "device_label" VARCHAR(160),
  ADD COLUMN "user_agent" VARCHAR(500),
  ADD COLUMN "ip_hash" CHAR(64),
  ADD COLUMN "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "sessions_user_id_device_hash_expires_at_idx"
  ON "sessions"("user_id", "device_hash", "expires_at");

CREATE TABLE "global_security_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "failed_login_lockout_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "max_failed_login_attempts" INTEGER NOT NULL DEFAULT 3,
  "lockout_duration_minutes" INTEGER NOT NULL DEFAULT 10,
  "session_lifetime_minutes" INTEGER NOT NULL DEFAULT 10080,
  "device_restrictions_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "updated_by_user_id" UUID,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "global_security_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "global_security_settings_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "global_security_settings_attempts_check" CHECK ("max_failed_login_attempts" BETWEEN 1 AND 10),
  CONSTRAINT "global_security_settings_lockout_duration_check" CHECK ("lockout_duration_minutes" BETWEEN 1 AND 1440),
  CONSTRAINT "global_security_settings_session_lifetime_check" CHECK ("session_lifetime_minutes" BETWEEN 5 AND 43200)
);

INSERT INTO "global_security_settings" ("id") VALUES (1);

UPDATE "subscription_plans"
SET "max_devices_per_user" = CASE lower("code")
  WHEN 'starter' THEN 1
  WHEN 'growth' THEN 3
  WHEN 'business' THEN 5
  ELSE 1
END;
