ALTER TABLE "organization_settings"
  ADD COLUMN "lead_auto_assign_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lead_auto_assign_user_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "lead_auto_assign_cursor" INTEGER NOT NULL DEFAULT 0;
