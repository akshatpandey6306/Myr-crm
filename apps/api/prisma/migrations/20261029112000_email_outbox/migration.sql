CREATE TYPE "email_delivery_status" AS ENUM ('not_configured', 'queued', 'sent', 'failed');

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_organization_id_id_key"
  UNIQUE ("organization_id", "id");

CREATE TABLE "email_messages" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "recipient_name" VARCHAR(120) NOT NULL,
  "recipient_email" VARCHAR(254) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "body" TEXT NOT NULL,
  "delivery_status" "email_delivery_status" NOT NULL DEFAULT 'not_configured',
  "sent_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_messages_subject_check" CHECK (length(btrim("subject")) > 0),
  CONSTRAINT "email_messages_body_check" CHECK (length(btrim("body")) > 0),
  CONSTRAINT "email_messages_sent_at_check"
    CHECK (("delivery_status" = 'sent') = ("sent_at" IS NOT NULL))
);

CREATE INDEX "email_messages_organization_id_created_at_idx"
  ON "email_messages"("organization_id", "created_at");
CREATE INDEX "email_messages_organization_id_contact_id_created_at_idx"
  ON "email_messages"("organization_id", "contact_id", "created_at");
CREATE INDEX "email_messages_organization_id_created_by_user_id_created_at_idx"
  ON "email_messages"("organization_id", "created_by_user_id", "created_at");

ALTER TABLE "email_messages"
  ADD CONSTRAINT "email_messages_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_messages"
  ADD CONSTRAINT "email_messages_organization_id_contact_id_fkey"
  FOREIGN KEY ("organization_id", "contact_id")
  REFERENCES "contacts"("organization_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_messages"
  ADD CONSTRAINT "email_messages_organization_id_created_by_user_id_fkey"
  FOREIGN KEY ("organization_id", "created_by_user_id")
  REFERENCES "memberships"("organization_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
