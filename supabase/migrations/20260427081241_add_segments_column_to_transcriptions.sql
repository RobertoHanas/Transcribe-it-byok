/*
  # Add segments column to transcriptions

  1. Modified Tables
    - `transcriptions`
      - `segments` (jsonb) - array of {start, end, text} objects from Whisper verbose_json
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcriptions' AND column_name = 'segments'
  ) THEN
    ALTER TABLE transcriptions ADD COLUMN segments jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;
