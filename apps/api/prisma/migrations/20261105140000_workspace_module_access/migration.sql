ALTER TABLE "organizations"
  ALTER COLUMN "enabled_modules" SET DEFAULT ARRAY[
    'leads', 'contacts', 'companies', 'deals', 'activities', 'team',
    'automation', 'email', 'reports', 'audit-logs', 'settings'
  ];

UPDATE "organizations"
SET "enabled_modules" = ARRAY(
  SELECT DISTINCT module
  FROM unnest("enabled_modules" || ARRAY['email', 'audit-logs', 'settings']) AS module
  ORDER BY module
);
