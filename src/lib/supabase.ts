import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export type TranscriptionStatus = "processing" | "completed" | "failed";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface ChunkStatus {
  storage_index: number;
  sub_index?: number;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
}

export interface Transcription {
  id: string;
  filename: string;
  file_size: number;
  status: TranscriptionStatus;
  transcript: string;
  segments: TranscriptSegment[] | null;
  error_message: string;
  session_id: string;
  chunks_done: number;
  chunks_total: number;
  chunk_statuses: ChunkStatus[] | null;
  created_at: string;
  updated_at: string;
}
