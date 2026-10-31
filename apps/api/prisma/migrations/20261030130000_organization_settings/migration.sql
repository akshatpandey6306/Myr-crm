CREATE TABLE "organization_settings" (
  "organization_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "week_starts_on" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "organization_settings_week_starts_on_check" CHECK ("week_starts_on" BETWEEN 0 AND 6)
);

ALTER TABLE "organization_settings"
  ADD CONSTRAINT "organization_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;