CREATE TABLE partner_api_usage_logs (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
partner_id UUID NOT NULL REFERENCES integration_partners(id) ON DELETE CASCADE ON UPDATE CASCADE,
api_key_id UUID NOT NULL REFERENCES partner_api_keys(id) ON DELETE CASCADE ON UPDATE CASCADE,
operation VARCHAR(80) NOT NULL,
created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX partner_api_usage_logs_partner_id_created_at_idx ON partner_api_usage_logs(partner_id, created_at);
CREATE INDEX partner_api_usage_logs_api_key_id_created_at_idx ON partner_api_usage_logs(api_key_id, created_at);
