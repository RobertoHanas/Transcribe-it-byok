/*
  # Add increment_chunks_done RPC

  Atomically increments the chunks_done counter on a transcription row.
  Used by parallel chunk processing to avoid read-modify-write races.
*/

CREATE OR REPLACE FUNCTION increment_chunks_done(record_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE transcriptions
  SET chunks_done = chunks_done + 1,
      updated_at = now()
  WHERE id = record_id;
$$;
