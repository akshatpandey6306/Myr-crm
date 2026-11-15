ALTER TABLE "memberships"
  ADD COLUMN "enabled_modules" TEXT[] NOT NULL
  DEFAULT ARRAY['leads', 'contacts', 'companies', 'deals', 'activities']::TEXT[];
