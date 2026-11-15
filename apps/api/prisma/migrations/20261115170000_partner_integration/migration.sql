ALTER TABLE provisioning_requests
  ADD COLUMN partner_id UUID,
  ADD COLUMN external_customer_ref VARCHAR(160),
  ADD COLUMN purchase_type VARCHAR(16),
  ADD COLUMN trial_started_at TIMESTAMPTZ(3),
  ADD COLUMN trial_ends_at TIMESTAMPTZ(3);

CREATE TABLE integration_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  permissions TEXT[] NOT NULL DEFAULT ARRAY['provision','customers:read','subscriptions:write']::TEXT[],
  webhook_url VARCHAR(2048),
  plans_url VARCHAR(2048),
  webhook_secret_enc TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE partner_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES integration_partners(id) ON DELETE CASCADE,
  key_prefix VARCHAR(24) NOT NULL,
  key_hash CHAR(64) NOT NULL UNIQUE,
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ(3),
  revoked_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX partner_api_keys_partner_id_active_idx ON partner_api_keys(partner_id, active);
CREATE TABLE partner_customer_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES integration_partners(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_customer_ref VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(partner_id, external_customer_ref)
);
CREATE INDEX partner_customer_mappings_email_idx ON partner_customer_mappings(email);
ALTER TABLE provisioning_requests ADD CONSTRAINT provisioning_requests_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES integration_partners(id) ON DELETE SET NULL;
CREATE TABLE partner_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES integration_partners(id) ON DELETE CASCADE,
  external_event_id VARCHAR(160) NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  organization_id UUID,
  payload_hash CHAR(64) NOT NULL,
  outcome VARCHAR(24) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(partner_id, external_event_id)
);
CREATE INDEX partner_webhook_events_created_at_idx ON partner_webhook_events(created_at);
CREATE TABLE partner_trial_eligibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash CHAR(64) NOT NULL UNIQUE,
  started_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  partner_id UUID NOT NULL REFERENCES integration_partners(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
