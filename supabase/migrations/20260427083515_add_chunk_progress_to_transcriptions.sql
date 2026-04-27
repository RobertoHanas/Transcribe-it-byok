/*
  # Add chunk progress tracking to transcriptions

  1. Changes
    - `chunks_done` (int) — how many Whisper chunks have completed
    - `chunks_total` (int) — total Whisper chunks expected for this file
  
  2. Notes
    - Both default to 0; updated by the edge function after each chunk
    - Used by the frontend to show a real progress bar during processing
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcriptions' AND column_name = 'chunks_done'
  ) THEN
    ALTER TABLE transcriptions ADD COLUMN chunks_done integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transcriptions' AND column_name = 'chunks_total'
  ) THEN
    ALTER TABLE transcriptions ADD COLUMN chunks_total integer NOT NULL DEFAULT 0;
  END IF;
END $$;
