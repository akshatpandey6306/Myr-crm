ALTER TABLE "platform_audit_logs"
  ADD CONSTRAINT "platform_audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;