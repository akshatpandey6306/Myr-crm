CREATE TABLE "organization_demo_data" (
    "organization_id" UUID NOT NULL,
    "loaded_at" TIMESTAMPTZ(3),
    "cleared_at" TIMESTAMPTZ(3),

    CONSTRAINT "organization_demo_data_pkey" PRIMARY KEY ("organization_id")
);

ALTER TABLE "organization_demo_data"
ADD CONSTRAINT "organization_demo_data_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
