CREATE TABLE IF NOT EXISTS organisation_settings (
  organisation_id UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  current_rms_auto_sync BOOLEAN NOT NULL DEFAULT TRUE,
  current_rms_sync_interval_minutes INTEGER NOT NULL DEFAULT 5
    CHECK (current_rms_sync_interval_minutes BETWEEN 2 AND 120),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS current_rms_cache_snapshots (
  organisation_id UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  jobs JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  range_from DATE,
  range_to DATE,
  synced_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS current_rms_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('automatic','manual','startup')),
  status TEXT NOT NULL CHECK (status IN ('running','success','failed','skipped')),
  started_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  jobs_count INTEGER NOT NULL DEFAULT 0,
  positions_count INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS current_rms_sync_runs_org_started_idx
  ON current_rms_sync_runs (organisation_id, started_at DESC);

INSERT INTO organisation_settings (organisation_id)
SELECT id FROM organisations
ON CONFLICT (organisation_id) DO NOTHING;

INSERT INTO current_rms_cache_snapshots (organisation_id)
SELECT id FROM organisations
ON CONFLICT (organisation_id) DO NOTHING;
