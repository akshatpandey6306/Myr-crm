ALTER TABLE "memberships"
ALTER COLUMN "enabled_modules" SET DEFAULT ARRAY[]::TEXT[];
