ALTER TABLE freelancer_applications
  ADD COLUMN IF NOT EXISTS current_rms_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS freelancer_applications_sync_status_idx
  ON freelancer_applications (organisation_id, current_rms_sync_status, updated_at DESC);
