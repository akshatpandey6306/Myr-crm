ALTER TABLE "organization_settings"
  ADD COLUMN "date_format" VARCHAR(24) NOT NULL DEFAULT 'DD MMM YYYY',
  ADD COLUMN "time_format" VARCHAR(8) NOT NULL DEFAULT '12h';
