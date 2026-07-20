CREATE TABLE IF NOT EXISTS available_work_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  opportunity_item_id TEXT NOT NULL,
  service_id TEXT,
  job_reference TEXT,
  job_name TEXT NOT NULL,
  customer_name TEXT,
  service_name TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  required_quantity INTEGER NOT NULL DEFAULT 0,
  allocated_quantity INTEGER NOT NULL DEFAULT 0,
  open_positions INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'ignored', 'closed')),
  audience_mode TEXT NOT NULL DEFAULT 'all_suitable'
    CHECK (audience_mode IN ('all_suitable', 'selected')),
  application_deadline TIMESTAMPTZ,
  freelancer_note TEXT,
  admin_note TEXT,
  published_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  unpublished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, opportunity_item_id)
);

CREATE TABLE IF NOT EXISTS available_work_exclusions (
  publication_id UUID NOT NULL
    REFERENCES available_work_publications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id UUID
    REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (publication_id, user_id)
);

CREATE TABLE IF NOT EXISTS available_work_inclusions (
  publication_id UUID NOT NULL
    REFERENCES available_work_publications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id UUID
    REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (publication_id, user_id)
);

CREATE INDEX IF NOT EXISTS available_work_publications_status_idx
  ON available_work_publications
  (organisation_id, status, starts_at);

CREATE INDEX IF NOT EXISTS available_work_exclusions_user_idx
  ON available_work_exclusions (user_id);

CREATE INDEX IF NOT EXISTS available_work_inclusions_user_idx
  ON available_work_inclusions (user_id);
