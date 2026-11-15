-- Clear the old schema default from non-administrator memberships. These
-- members must receive explicit module grants from a workspace administrator.
UPDATE "memberships"
SET "enabled_modules" = ARRAY[]::TEXT[]
WHERE "role" IN ('sales_manager', 'sales_rep', 'read_only')
  AND "enabled_modules" = ARRAY['leads', 'contacts', 'companies', 'deals', 'activities']::TEXT[];
