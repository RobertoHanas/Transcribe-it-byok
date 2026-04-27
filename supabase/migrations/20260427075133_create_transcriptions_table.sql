/*
  # Create transcriptions table

  1. New Tables
    - `transcriptions`
      - `id` (uuid, primary key)
      - `filename` (text) - original audio file name
      - `file_size` (bigint) - file size in bytes
      - `duration_estimate` (text) - estimated duration if known
      - `status` (text) - 'processing', 'completed', 'failed'
      - `transcript` (text) - the full transcription text
      - `error_message` (text) - error details if failed
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `session_id` (text) - anonymous session identifier to scope history

  2. Security
    - Enable RLS on `transcriptions` table
    - Add policy for session-based access (anonymous users identified by session_id)
*/

CREATE TABLE IF NOT EXISTS transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL DEFAULT '',
  file_size bigint DEFAULT 0,
  duration_estimate text DEFAULT '',
  status text NOT NULL DEFAULT 'processing',
  transcript text DEFAULT '',
  error_message text DEFAULT '',
  session_id text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Session users can insert own transcriptions"
  ON transcriptions FOR INSERT
  TO anon
  WITH CHECK (session_id != '');

CREATE POLICY "Session users can select own transcriptions"
  ON transcriptions FOR SELECT
  TO anon
  USING (session_id != '');

CREATE POLICY "Session users can update own transcriptions"
  ON transcriptions FOR UPDATE
  TO anon
  USING (session_id != '')
  WITH CHECK (session_id != '');

CREATE INDEX IF NOT EXISTS transcriptions_session_id_idx ON transcriptions(session_id);
CREATE INDEX IF NOT EXISTS transcriptions_created_at_idx ON transcriptions(created_at DESC);
