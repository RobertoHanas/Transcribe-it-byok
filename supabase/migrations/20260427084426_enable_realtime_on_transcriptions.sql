/*
  # Enable Realtime on transcriptions table

  Adds the transcriptions table to the Supabase Realtime publication
  so the frontend can subscribe to live row-level changes (INSERT, UPDATE, DELETE).
*/

ALTER PUBLICATION supabase_realtime ADD TABLE transcriptions;
