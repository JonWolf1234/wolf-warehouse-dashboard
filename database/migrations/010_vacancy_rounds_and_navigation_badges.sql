ALTER TABLE available_work_publications
  ADD COLUMN IF NOT EXISTS vacancy_round INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS previous_assignee_name TEXT,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

ALTER TABLE freelancer_applications
  ADD COLUMN IF NOT EXISTS vacancy_round INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS historical_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

ALTER TABLE freelancer_applications
  DROP CONSTRAINT IF EXISTS freelancer_applications_status_check;

ALTER TABLE freelancer_applications
  ADD CONSTRAINT freelancer_applications_status_check
  CHECK (
    status IN (
      'pending',
      'accepted',
      'declined',
      'withdrawn',
      'expired',
      'returned',
      'historical'
    )
  );

DROP INDEX IF EXISTS freelancer_applications_active_unique;

CREATE UNIQUE INDEX freelancer_applications_active_unique
  ON freelancer_applications (
    user_id,
    opportunity_item_id,
    vacancy_round
  )
  WHERE status IN (
    'pending',
    'accepted'
  );

CREATE INDEX IF NOT EXISTS freelancer_applications_round_idx
  ON freelancer_applications (
    organisation_id,
    opportunity_item_id,
    vacancy_round,
    status
  );
