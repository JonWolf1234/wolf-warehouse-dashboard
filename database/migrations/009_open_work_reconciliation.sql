ALTER TABLE available_work_publications
  ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS available_work_publications_auto_closed_idx
  ON available_work_publications (
    organisation_id,
    auto_closed,
    status
  );
