BEGIN;

ALTER TABLE "lead_calls"
  ADD COLUMN "activity_id" UUID;

CREATE TEMPORARY TABLE "lead_call_activity_backfill" AS
SELECT "id" AS "call_id", gen_random_uuid() AS "activity_id"
FROM "lead_calls";

INSERT INTO "activities" (
  "id", "organization_id", "type", "title", "description", "status", "priority",
  "due_at", "completed_at", "assigned_to_user_id", "related_to_type", "related_to_id",
  "created_by_user_id", "created_at", "updated_at"
)
SELECT
  backfill."activity_id",
  calls."organization_id",
  'call'::"activity_type",
  left('Call with ' || leads."name", 160),
  concat_ws(E'\n',
    'Call status: ' || replace(calls."call_status", '_', ' '),
    CASE WHEN calls."duration_seconds" IS NOT NULL THEN 'Duration: ' || calls."duration_seconds" || ' seconds' END,
    CASE WHEN calls."customer_response" IS NOT NULL THEN 'Customer response: ' || calls."customer_response" END,
    CASE WHEN calls."next_action" IS NOT NULL THEN 'Next action: ' || calls."next_action" END
  ),
  'completed'::"activity_status",
  'normal'::"activity_priority",
  calls."called_at",
  calls."called_at",
  calls."logged_by_user_id",
  'lead'::"related_record_type",
  calls."lead_id",
  calls."logged_by_user_id",
  calls."called_at",
  calls."called_at"
FROM "lead_call_activity_backfill" AS backfill
JOIN "lead_calls" AS calls ON calls."id" = backfill."call_id"
JOIN "leads" AS leads
  ON leads."organization_id" = calls."organization_id"
 AND leads."id" = calls."lead_id";

UPDATE "lead_calls" AS calls
SET "activity_id" = backfill."activity_id"
FROM "lead_call_activity_backfill" AS backfill
WHERE calls."id" = backfill."call_id";

ALTER TABLE "lead_calls"
  ALTER COLUMN "activity_id" SET NOT NULL;

ALTER TABLE "lead_calls"
  ADD CONSTRAINT "lead_calls_organization_id_activity_id_fkey"
  FOREIGN KEY ("organization_id", "activity_id")
  REFERENCES "activities"("organization_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "lead_calls_organization_id_activity_id_key"
  ON "lead_calls"("organization_id", "activity_id");

COMMIT;
