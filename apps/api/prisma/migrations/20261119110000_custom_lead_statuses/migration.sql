ALTER TABLE "leads"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "leads"
  ALTER COLUMN "status" TYPE VARCHAR(48) USING "status"::text;

ALTER TABLE "leads"
  ALTER COLUMN "status" SET DEFAULT 'new';

ALTER TABLE "automation_rules"
  ALTER COLUMN "trigger_status" TYPE VARCHAR(48) USING "trigger_status"::text;

DROP TYPE "lead_status";
