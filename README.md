# Whisper Transcriber

A browser-based audio transcription app powered by [OpenAI Whisper](https://platform.openai.com/docs/guides/speech-to-text). Upload any audio or video file — no matter how long — and get a timestamped transcript back in minutes.

**Bring your own key.** Your OpenAI API key is stored only in your browser's localStorage and sent directly to Whisper. Nothing is stored server-side.

---

## Features

- Transcribes MP3, WAV, OGG, FLAC, WebM, and MP4/M4A files of any size
- MP4/M4A container files are decoded to WAV in the browser before upload
- Large files are split into chunks and processed in parallel — no timeouts
- Live progress with per-chunk status (pending / processing / completed / failed)
- Timestamped transcript with copy-to-clipboard
- Full history per browser session with delete
- Failed chunks do not abort the rest of the job — partial transcripts are preserved

---

## Running it yourself

### What you need

| Requirement | Where to get it |
|---|---|
| [Node.js](https://nodejs.org) 18+ | nodejs.org |
| A [Supabase](https://supabase.com) project (free tier works) | supabase.com |
| An [OpenAI API key](https://platform.openai.com/api-keys) with Whisper access | platform.openai.com |

---

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd whisper-transcriber
npm install
```

---

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Once created, open **Project Settings → API** and copy:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **Anon / public key**

---

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

---

### 4. Apply database migrations

In your Supabase dashboard, open the **SQL Editor** and run each file in `supabase/migrations/` in order (oldest timestamp first):

```
20260427075133_create_transcriptions_table.sql
20260427080119_create_audio_storage_bucket.sql
20260427081241_add_segments_column_to_transcriptions.sql
20260427083515_add_chunk_progress_to_transcriptions.sql
20260427084426_enable_realtime_on_transcriptions.sql
20260427104357_add_chunk_statuses_to_transcriptions.sql
20260427104507_add_increment_chunks_done_rpc.sql
```

Paste and run each file's SQL content in the editor.

> Alternatively, if you have the [Supabase CLI](https://supabase.com/docs/guides/cli) installed and linked to your project:
> ```bash
> supabase db push
> ```

---

### 5. Deploy the edge function

The transcription logic runs as a Supabase Edge Function. Deploy it using the Supabase CLI:

```bash
supabase functions deploy transcribe-audio --no-verify-jwt
```

If you don't have the CLI, you can paste the contents of `supabase/functions/transcribe-audio/index.ts` directly in **Supabase Dashboard → Edge Functions → New Function**.

---

### 6. Enable Realtime on the transcriptions table

In the Supabase dashboard:

1. Go to **Database → Replication** (or **Table Editor → transcriptions → Edit**)
2. Enable Realtime for the `transcriptions` table

This allows the UI to update live as chunks complete.

---

### 7. Run the dev server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### 8. Use the app

1. Paste your **OpenAI API key** into the field at the top — it's saved in your browser.
2. Drop or select an audio/video file.
3. Click **Transcribe**.
4. Watch chunks process in parallel. The transcript fills in as each part completes.
5. Use **Copy** to grab the full text with or without timestamps.
6. Use **Delete** to remove old or failed jobs.

---

## Building for production

```bash
npm run build
```

The output goes to `dist/`. Deploy to any static host (Vercel, Netlify, Cloudflare Pages, etc.). No server required — all backend logic runs in Supabase.

---

## Architecture overview

```
Browser
  └── React + Vite (static frontend)
        ├── Uploads audio parts to Supabase Storage
        ├── Calls edge function: mode=init  (count chunks, set up DB record)
        ├── Calls edge function: mode=chunk (one call per file, in parallel)
        │     └── Downloads file from Storage
        │           └── Splits into ≤20 MB Whisper-safe sub-chunks
        │                 └── Sends each to OpenAI Whisper API
        │                       └── Writes segments back to DB
        └── Calls edge function: mode=finalize (merge + write final transcript)

Supabase
  ├── Storage bucket: audio-uploads (temporary, auto-deleted after transcription)
  ├── Table: transcriptions (history, segments, chunk progress)
  └── Edge Function: transcribe-audio (Deno, one invocation per storage file)
```

Each edge function invocation handles one file and completes in under 2 minutes, well within Supabase's 540-second limit. Long recordings are automatically split into multiple files and processed in parallel.

---

## Cost estimate

Whisper pricing is $0.006 per minute of audio.

| File | Approximate cost |
|---|---|
| 30-minute sermon / meeting | ~$0.18 |
| 1-hour recording | ~$0.36 |
| 2-hour recording | ~$0.72 |

Supabase free tier handles the storage and edge function calls at no cost for typical usage.
