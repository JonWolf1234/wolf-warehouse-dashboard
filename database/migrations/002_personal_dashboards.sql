ALTER TABLE users
  ADD COLUMN IF NOT EXISTS person_type TEXT;

UPDATE users
SET person_type = CASE
  WHEN employment_type = 'freelancer' THEN 'freelancer'
  ELSE 'staff'
END
WHERE person_type IS NULL;

ALTER TABLE users
  ALTER COLUMN person_type SET DEFAULT 'staff';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS current_rms_record_type TEXT,
  ADD COLUMN IF NOT EXISTS current_rms_record_id TEXT;

UPDATE users
SET current_rms_record_type = CASE
      WHEN current_rms_member_id IS NOT NULL AND current_rms_member_id <> '' THEN 'member'
      WHEN current_rms_contact_id IS NOT NULL AND current_rms_contact_id <> '' THEN 'contact'
      ELSE 'none'
    END,
    current_rms_record_id = COALESCE(NULLIF(current_rms_member_id, ''), NULLIF(current_rms_contact_id, ''))
WHERE current_rms_record_type IS NULL OR current_rms_record_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_person_type_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_person_type_check
      CHECK (person_type IN ('staff', 'freelancer'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_current_rms_record_type_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_current_rms_record_type_check
      CHECK (current_rms_record_type IN ('member', 'contact', 'none'));
  END IF;
END $$;
