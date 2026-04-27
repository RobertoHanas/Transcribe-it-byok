/*
  # Add chunk_statuses column to transcriptions

  Stores per-chunk status so the UI can show each chunk's state independently
  and allow individual chunk retries without affecting the whole job.

  1. Changes
    - `transcriptions`: add `chunk_statuses` jsonb column (array of {index, status, error?})
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcriptions' AND column_name = 'chunk_statuses'
  ) THEN
    ALTER TABLE transcriptions ADD COLUMN chunk_statuses jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;
