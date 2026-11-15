ALTER TABLE partner_webhook_events ADD CONSTRAINT partner_webhook_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE;
