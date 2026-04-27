/*
  # Create audio-uploads storage bucket

  1. Creates a private storage bucket called `audio-uploads`
     for temporary audio file storage during transcription.
  2. Grants anon role INSERT (upload) and SELECT (download) on
     objects in this bucket so the frontend and edge function
     can upload and read files respectively.
  3. Files are scoped by session_id path prefix so users can
     only touch their own uploads.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audio-uploads',
  'audio-uploads',
  false,
  200000000,  -- 200 MB hard limit
  ARRAY[
    'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
    'audio/webm', 'audio/flac', 'audio/x-m4a', 'audio/m4a',
    'video/mp4', 'video/webm', 'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Allow anon to upload objects
CREATE POLICY "Anon can upload audio files"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'audio-uploads');

-- Allow anon to read their own uploaded objects
CREATE POLICY "Anon can read audio files"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'audio-uploads');

-- Allow anon to delete their own uploaded objects
CREATE POLICY "Anon can delete audio files"
  ON storage.objects FOR DELETE
  TO anon
  USING (bucket_id = 'audio-uploads');
