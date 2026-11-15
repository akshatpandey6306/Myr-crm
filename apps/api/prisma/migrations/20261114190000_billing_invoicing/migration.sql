-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');


-- CreateEnum
CREATE TYPE "BillingInvoicePaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');


-- CreateEnum
CREATE TYPE "BillingQuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');


-- CreateEnum
CREATE TYPE "BillingCustomerType" AS ENUM ('CONTACT', 'COMPANY', 'CUSTOM');


-- CreateEnum
CREATE TYPE "BillingPaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'PAYMENT_GATEWAY', 'OTHER');


-- CreateEnum
CREATE TYPE "BillingDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');


-- CreateEnum
CREATE TYPE "BillingTaxSystem" AS ENUM ('GENERIC', 'INDIA_GST');


-- CreateTable
CREATE TABLE "billing_settings" (
    "organization_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "currency_precision" INTEGER NOT NULL DEFAULT 2,
    "country_code" CHAR(2) NOT NULL DEFAULT 'US',
    "tax_system" "BillingTaxSystem" NOT NULL DEFAULT 'GENERIC',
    "business_name" VARCHAR(160),
    "business_email" VARCHAR(254),
    "business_phone" VARCHAR(40),
    "business_address" TEXT,
    "gstin" VARCHAR(32),
    "registration_state_code" VARCHAR(8),
    "invoice_prefix" VARCHAR(12) NOT NULL DEFAULT 'INV',
    "quote_prefix" VARCHAR(12) NOT NULL DEFAULT 'QTN',
    "receipt_prefix" VARCHAR(12) NOT NULL DEFAULT 'REC',
    "invoice_next_number" INTEGER NOT NULL DEFAULT 1,
    "quote_next_number" INTEGER NOT NULL DEFAULT 1,
    "receipt_next_number" INTEGER NOT NULL DEFAULT 1,
    "default_due_days" INTEGER NOT NULL DEFAULT 30,
    "default_tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "default_terms" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("organization_id")
);


-- CreateTable
CREATE TABLE "billing_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(120),
    "unit" VARCHAR(24) NOT NULL DEFAULT 'unit',
    "selling_price" DECIMAL(18,4) NOT NULL,
    "purchase_price" DECIMAL(18,4),
    "tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "hsn_sac_code" VARCHAR(32),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_products_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_number" VARCHAR(40),
    "customer_type" "BillingCustomerType" NOT NULL,
    "contact_id" UUID,
    "company_id" UUID,
    "customer_name" VARCHAR(160) NOT NULL,
    "customer_email" VARCHAR(254),
    "customer_phone" VARCHAR(40),
    "billing_address" TEXT,
    "shipping_address" TEXT,
    "place_of_supply" VARCHAR(120),
    "purchase_order_number" VARCHAR(80),
    "reference_number" VARCHAR(80),
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "BillingInvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_type" "BillingDiscountType" NOT NULL DEFAULT 'FIXED',
    "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "additional_charges" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shipping_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance_due" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "internal_notes" TEXT,
    "terms" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "billing_invoice_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "product_id" UUID,
    "item_name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "sku" VARCHAR(64),
    "hsn_sac_code" VARCHAR(32),
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" VARCHAR(24) NOT NULL DEFAULT 'unit',
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_type" "BillingDiscountType" NOT NULL DEFAULT 'FIXED',
    "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoice_discount_allocation" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "billing_invoice_items_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "billing_quotations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quotation_number" VARCHAR(40),
    "customer_type" "BillingCustomerType" NOT NULL,
    "contact_id" UUID,
    "company_id" UUID,
    "customer_name" VARCHAR(160) NOT NULL,
    "customer_email" VARCHAR(254),
    "customer_phone" VARCHAR(40),
    "billing_address" TEXT,
    "shipping_address" TEXT,
    "valid_until" DATE,
    "currency" CHAR(3) NOT NULL,
    "status" "BillingQuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_type" "BillingDiscountType" NOT NULL DEFAULT 'FIXED',
    "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "terms" TEXT,
    "notes" TEXT,
    "converted_invoice_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_quotations_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "billing_quotation_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "product_id" UUID,
    "item_name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "sku" VARCHAR(64),
    "hsn_sac_code" VARCHAR(32),
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" VARCHAR(24) NOT NULL DEFAULT 'unit',
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_type" "BillingDiscountType" NOT NULL DEFAULT 'FIXED',
    "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoice_discount_allocation" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "billing_quotation_items_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "billing_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "payment_number" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "payment_date" TIMESTAMPTZ(3) NOT NULL,
    "method" "BillingPaymentMethod" NOT NULL,
    "transaction_reference" VARCHAR(120),
    "idempotency_key" VARCHAR(128),
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "billing_receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "receipt_number" VARCHAR(40) NOT NULL,
    "customer_name" VARCHAR(160) NOT NULL,
    "invoice_number" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "payment_date" TIMESTAMPTZ(3) NOT NULL,
    "payment_method" "BillingPaymentMethod" NOT NULL,
    "transaction_reference" VARCHAR(120),
    "previous_balance" DECIMAL(18,4) NOT NULL,
    "remaining_balance" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_receipts_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "billing_audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "resource_type" VARCHAR(48) NOT NULL,
    "resource_id" UUID NOT NULL,
    "action" VARCHAR(48) NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_audit_events_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "billing_products_organization_id_is_active_name_idx" ON "billing_products"("organization_id", "is_active", "name");


-- CreateIndex
CREATE UNIQUE INDEX "billing_products_organization_id_id_key" ON "billing_products"("organization_id", "id");


-- CreateIndex
CREATE UNIQUE INDEX "billing_products_organization_id_sku_key" ON "billing_products"("organization_id", "sku");


-- CreateIndex
CREATE INDEX "billing_invoices_organization_id_status_invoice_date_idx" ON "billing_invoices"("organization_id", "status", "invoice_date");


-- CreateIndex
CREATE INDEX "billing_invoices_organization_id_due_date_status_idx" ON "billing_invoices"("organization_id", "due_date", "status");


-- CreateIndex
CREATE INDEX "billing_invoices_organization_id_customer_name_idx" ON "billing_invoices"("organization_id", "customer_name");


-- CreateIndex
CREATE INDEX "billing_invoices_organization_id_owner_user_id_created_at_idx" ON "billing_invoices"("organization_id", "owner_user_id", "created_at");


-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_organization_id_id_key" ON "billing_invoices"("organization_id", "id");


-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_organization_id_invoice_number_key" ON "billing_invoices"("organization_id", "invoice_number");


-- CreateIndex
CREATE INDEX "billing_invoice_items_organization_id_invoice_id_position_idx" ON "billing_invoice_items"("organization_id", "invoice_id", "position");


-- CreateIndex
CREATE UNIQUE INDEX "billing_invoice_items_organization_id_id_key" ON "billing_invoice_items"("organization_id", "id");


-- CreateIndex
CREATE INDEX "billing_quotations_organization_id_status_created_at_idx" ON "billing_quotations"("organization_id", "status", "created_at");


-- CreateIndex
CREATE UNIQUE INDEX "billing_quotations_organization_id_id_key" ON "billing_quotations"("organization_id", "id");


-- CreateIndex
CREATE UNIQUE INDEX "billing_quotations_organization_id_quotation_number_key" ON "billing_quotations"("organization_id", "quotation_number");


-- CreateIndex
CREATE UNIQUE INDEX "billing_quotations_organization_id_converted_invoice_id_key" ON "billing_quotations"("organization_id", "converted_invoice_id");


-- CreateIndex
CREATE INDEX "billing_quotation_items_organization_id_quotation_id_positi_idx" ON "billing_quotation_items"("organization_id", "quotation_id", "position");


-- CreateIndex
CREATE UNIQUE INDEX "billing_quotation_items_organization_id_id_key" ON "billing_quotation_items"("organization_id", "id");


-- CreateIndex
CREATE INDEX "billing_payments_organization_id_invoice_id_payment_date_idx" ON "billing_payments"("organization_id", "invoice_id", "payment_date");


-- CreateIndex
CREATE INDEX "billing_payments_organization_id_payment_date_idx" ON "billing_payments"("organization_id", "payment_date");


-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_organization_id_id_key" ON "billing_payments"("organization_id", "id");


-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_organization_id_payment_number_key" ON "billing_payments"("organization_id", "payment_number");


-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_organization_id_idempotency_key_key" ON "billing_payments"("organization_id", "idempotency_key");


-- CreateIndex
CREATE INDEX "billing_receipts_organization_id_created_at_idx" ON "billing_receipts"("organization_id", "created_at");


-- CreateIndex
CREATE UNIQUE INDEX "billing_receipts_organization_id_id_key" ON "billing_receipts"("organization_id", "id");


-- CreateIndex
CREATE UNIQUE INDEX "billing_receipts_organization_id_payment_id_key" ON "billing_receipts"("organization_id", "payment_id");


-- CreateIndex
CREATE UNIQUE INDEX "billing_receipts_organization_id_receipt_number_key" ON "billing_receipts"("organization_id", "receipt_number");


-- CreateIndex
CREATE INDEX "billing_audit_events_organization_id_resource_type_resource_idx" ON "billing_audit_events"("organization_id", "resource_type", "resource_id", "created_at");


-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_products" ADD CONSTRAINT "billing_products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_products" ADD CONSTRAINT "billing_products_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_owner_user_id_fkey" FOREIGN KEY ("organization_id", "owner_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_invoice_items" ADD CONSTRAINT "billing_invoice_items_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "billing_invoices"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_invoice_items" ADD CONSTRAINT "billing_invoice_items_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "billing_products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_quotations" ADD CONSTRAINT "billing_quotations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_quotations" ADD CONSTRAINT "billing_quotations_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_quotations" ADD CONSTRAINT "billing_quotations_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_quotations" ADD CONSTRAINT "billing_quotations_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_quotations" ADD CONSTRAINT "billing_quotations_organization_id_converted_invoice_id_fkey" FOREIGN KEY ("organization_id", "converted_invoice_id") REFERENCES "billing_invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_quotation_items" ADD CONSTRAINT "billing_quotation_items_organization_id_quotation_id_fkey" FOREIGN KEY ("organization_id", "quotation_id") REFERENCES "billing_quotations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_quotation_items" ADD CONSTRAINT "billing_quotation_items_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "billing_products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "billing_invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_receipts" ADD CONSTRAINT "billing_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_receipts" ADD CONSTRAINT "billing_receipts_organization_id_payment_id_fkey" FOREIGN KEY ("organization_id", "payment_id") REFERENCES "billing_payments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_organization_id_actor_user_id_fkey" FOREIGN KEY ("organization_id", "actor_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Enable billing for existing workspaces and make it available to new workspaces.
ALTER TABLE "organizations" ALTER COLUMN "enabled_modules" SET DEFAULT ARRAY['leads', 'contacts', 'companies', 'deals', 'activities', 'vendors', 'billing-invoicing', 'team', 'automation', 'email', 'reports', 'audit-logs', 'settings']::TEXT[];

UPDATE "organizations"
SET "enabled_modules" = array_append("enabled_modules", 'billing-invoicing')
WHERE NOT ('billing-invoicing' = ANY("enabled_modules"));
