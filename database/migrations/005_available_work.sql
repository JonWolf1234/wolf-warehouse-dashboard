ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_approve_freelancers BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suitable_service_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS freelancer_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  opportunity_item_id TEXT NOT NULL,
  service_id TEXT,
  job_reference TEXT,
  job_name TEXT NOT NULL,
  customer_name TEXT,
  service_name TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  decline_reason TEXT,
  current_rms_sync_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (current_rms_sync_status IN ('not_started', 'pending', 'synced', 'failed')),
  current_rms_allocation_id TEXT,
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS freelancer_applications_active_unique
  ON freelancer_applications (user_id, opportunity_item_id)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS freelancer_applications_org_status_idx
  ON freelancer_applications (organisation_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS freelancer_applications_user_idx
  ON freelancer_applications (user_id, created_at DESC);
