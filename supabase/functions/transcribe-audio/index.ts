import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface ChunkResult {
  chunk_index: number;
  segments: Segment[];
  time_offset_end: number;
}

// Whisper hard limit is 25 MB. Stay well under at 20 MB.
const WHISPER_LIMIT = 20 * 1024 * 1024;
const MP3_EXTS = new Set(["mp3", "mpeg", "mpga"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { mode } = body;
    if (mode === "init") return handleInit(body);
    if (mode === "chunk") return handleChunk(body);
    if (mode === "finalize") return handleFinalize(body);
    return json({ error: "Unknown mode" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
// HEAD-requests every storage part to count total chunks. Returns the list of
// { storage_path, chunk_index, time_offset_start } so the frontend can dispatch
// them in parallel without needing to compute offsets itself.
// NOTE: time offsets are estimates based on file size; actual offsets come back
// from each chunk call and are assembled by the frontend.
async function handleInit(body: Record<string, unknown>): Promise<Response> {
  const { openai_key, transcription_id, session_id, storage_paths, filename } = body as {
    openai_key: string;
    transcription_id: string;
    session_id: string;
    storage_paths: string[];
    filename: string;
  };

  if (!openai_key || !transcription_id || !session_id || !storage_paths?.length) {
    return json({ error: "Missing required fields" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const ext = (filename ?? storage_paths[0]).split(".").pop()?.toLowerCase() ?? "mp3";
  const parts: Array<{ storage_path: string; chunk_index: number; sub_chunks: number }> = [];
  let totalChunks = 0;

  for (let i = 0; i < storage_paths.length; i++) {
    const path = storage_paths[i];
    const { data: sd } = await supabase.storage.from("audio-uploads").createSignedUrl(path, 3600);
    let subChunks = 1;
    if (sd?.signedUrl) {
      const head = await fetch(sd.signedUrl, { method: "HEAD" });
      const size = parseInt(head.headers.get("content-length") ?? "0", 10);
      if (ext !== "wav") {
        subChunks = Math.max(1, Math.ceil(size / WHISPER_LIMIT));
      }
    }
    parts.push({ storage_path: path, chunk_index: i, sub_chunks: subChunks });
    totalChunks += subChunks;
  }

  // Initialise chunk_statuses array so the UI can render all chunks immediately
  const chunkStatuses = parts.flatMap((p) =>
    Array.from({ length: p.sub_chunks }, (_, si) => ({
      storage_index: p.chunk_index,
      sub_index: si,
      status: "pending",
    }))
  );

  await supabase
    .from("transcriptions")
    .update({
      chunks_total: totalChunks,
      chunks_done: 0,
      status: "processing",
      chunk_statuses: chunkStatuses,
    })
    .eq("id", transcription_id)
    .eq("session_id", session_id);

  return json({ total_chunks: totalChunks, parts });
}

// ── Chunk ─────────────────────────────────────────────────────────────────────
// Processes one storage part independently. The caller provides the time_offset
// for this part so chunks can be dispatched in parallel (offsets are pre-computed
// sequentially before parallel dispatch by the frontend).
// Returns the segments for this part only — the frontend assembles the full transcript.
async function handleChunk(body: Record<string, unknown>): Promise<Response> {
  const {
    openai_key,
    transcription_id,
    session_id,
    storage_path,
    chunk_index,
    filename,
    content_type,
    time_offset,
  } = body as {
    openai_key: string;
    transcription_id: string;
    session_id: string;
    storage_path: string;
    chunk_index: number;
    filename: string;
    content_type: string;
    time_offset: number;
  };

  if (!openai_key || !transcription_id || !session_id || !storage_path) {
    return json({ error: "Missing required fields" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const ext = (filename ?? storage_path).split(".").pop()?.toLowerCase() ?? "mp3";
  const mimeType = content_type || getMime(ext);
  let timeOffset = time_offset ?? 0;

  // Mark this chunk as processing in chunk_statuses
  await updateChunkStatus(supabase, transcription_id, session_id, chunk_index, "processing", null);

  let fullBuf: ArrayBuffer;
  try {
    const { data: signedData, error: signErr } = await supabase.storage
      .from("audio-uploads")
      .createSignedUrl(storage_path, 3600);
    if (signErr || !signedData?.signedUrl) throw new Error(`Failed to sign URL: ${signErr?.message}`);

    const res = await fetch(signedData.signedUrl);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    fullBuf = await res.arrayBuffer();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateChunkStatus(supabase, transcription_id, session_id, chunk_index, "failed", msg);
    return json({ error: msg }, 500);
  }

  // Split into Whisper-safe sub-chunks
  let subChunks: ArrayBuffer[];
  if (fullBuf.byteLength <= WHISPER_LIMIT) {
    subChunks = [fullBuf];
  } else if (MP3_EXTS.has(ext)) {
    subChunks = splitMp3(fullBuf, WHISPER_LIMIT);
  } else if (ext === "wav") {
    subChunks = splitWav(fullBuf, WHISPER_LIMIT);
  } else {
    subChunks = [fullBuf];
  }

  const allSegments: Segment[] = [];

  for (let si = 0; si < subChunks.length; si++) {
    const subChunkName = `chunk_${chunk_index}_${si}.${ext}`;
    try {
      const newSegs = await transcribeChunk(subChunks[si], subChunkName, mimeType, openai_key, timeOffset);
      const cleaned = stripHallucinations(newSegs);
      allSegments.push(...cleaned);
      timeOffset = cleaned.length > 0 ? cleaned[cleaned.length - 1].end : timeOffset;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateChunkStatus(supabase, transcription_id, session_id, chunk_index, "failed", msg);
      return json({ error: msg }, 500);
    }
  }

  // Clean up this storage file
  await supabase.storage.from("audio-uploads").remove([storage_path]);

  // Mark chunk done and increment chunks_done counter atomically
  await updateChunkStatus(supabase, transcription_id, session_id, chunk_index, "completed", null);
  await supabase.rpc("increment_chunks_done", { record_id: transcription_id });

  const result: ChunkResult = {
    chunk_index,
    segments: allSegments,
    time_offset_end: timeOffset,
  };

  return json({ success: true, result });
}

// ── Finalize ──────────────────────────────────────────────────────────────────
// Called by the frontend after all parallel chunks complete. Receives the full
// ordered segments array and writes the final transcript + completed status.
async function handleFinalize(body: Record<string, unknown>): Promise<Response> {
  const { transcription_id, session_id, segments, has_failures } = body as {
    transcription_id: string;
    session_id: string;
    segments: Segment[];
    has_failures: boolean;
  };

  if (!transcription_id || !session_id) {
    return json({ error: "Missing required fields" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const transcript = segments.map((s) => s.text).join(" ").trim();

  await supabase
    .from("transcriptions")
    .update({
      transcript,
      segments,
      status: has_failures ? "failed" : "completed",
      error_message: has_failures ? "One or more chunks failed. Partial transcript available." : "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", transcription_id)
    .eq("session_id", session_id);

  return json({ success: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function updateChunkStatus(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  transcriptionId: string,
  sessionId: string,
  chunkIndex: number,
  status: string,
  error: string | null
) {
  // Read current chunk_statuses, update the matching entry, write back
  const { data } = await supabase
    .from("transcriptions")
    .select("chunk_statuses")
    .eq("id", transcriptionId)
    .maybeSingle();

  // deno-lint-ignore no-explicit-any
  const statuses: any[] = data?.chunk_statuses ?? [];
  const idx = statuses.findIndex((s: { storage_index: number }) => s.storage_index === chunkIndex);
  const updated = { ...statuses[idx] ?? { storage_index: chunkIndex }, status };
  if (error) updated.error = error;
  else delete updated.error;

  if (idx >= 0) statuses[idx] = updated;
  else statuses.push(updated);

  await supabase
    .from("transcriptions")
    .update({ chunk_statuses: statuses, updated_at: new Date().toISOString() })
    .eq("id", transcriptionId)
    .eq("session_id", sessionId);
}

function stripHallucinations(segments: Segment[]): Segment[] {
  if (segments.length < 3) return segments;
  function norm(t: string) { return t.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F]/g, "").trim(); }
  const tailNorm = norm(segments[segments.length - 1].text);
  if (!tailNorm) return segments;
  let runLength = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (norm(segments[i].text) === tailNorm) runLength++;
    else break;
  }
  if (runLength >= 3) return segments.slice(0, segments.length - runLength + 1);
  return segments;
}

function splitMp3(buf: ArrayBuffer, maxBytes: number): ArrayBuffer[] {
  const bytes = new Uint8Array(buf);
  const total = bytes.length;
  const chunks: ArrayBuffer[] = [];
  let chunkStart = 0;
  let scanStart = 0;

  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const id3Size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
       (bytes[9] & 0x7f);
    scanStart = 10 + id3Size;
  }

  while (chunkStart < total) {
    const targetEnd = chunkStart + maxBytes;
    if (targetEnd >= total) { chunks.push(buf.slice(chunkStart)); break; }
    let splitAt = -1;
    const searchFrom = Math.max(chunkStart + scanStart + 1, targetEnd - 8192);
    for (let i = targetEnd; i >= searchFrom; i--) {
      if (bytes[i] === 0xFF && (bytes[i + 1] & 0xE0) === 0xE0) { splitAt = i; break; }
    }
    if (splitAt <= chunkStart) splitAt = targetEnd;
    chunks.push(buf.slice(chunkStart, splitAt));
    chunkStart = splitAt;
    scanStart = 0;
  }

  return chunks.length > 0 ? chunks : [buf];
}

function splitWav(buf: ArrayBuffer, maxBytes: number): ArrayBuffer[] {
  const view = new DataView(buf);
  const riff = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (riff !== "RIFF") return [buf];

  let pos = 12;
  let dataOffset = -1;
  let dataSize = 0;

  while (pos + 8 <= buf.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(buf, pos, 4));
    const size = view.getUint32(pos + 4, true);
    if (id === "data") { dataOffset = pos + 8; dataSize = size; break; }
    pos += 8 + size;
    if (size % 2 !== 0) pos++;
  }

  if (dataOffset === -1) return [buf];
  const headerBytes = dataOffset;
  const pcmData = new Uint8Array(buf, dataOffset, dataSize);
  const pcmPerChunk = maxBytes - headerBytes;
  if (pcmPerChunk <= 0) return [buf];

  const chunks: ArrayBuffer[] = [];
  let offset = 0;
  while (offset < dataSize) {
    const chunkPcmSize = Math.min(pcmPerChunk, dataSize - offset);
    const chunkBuf = new ArrayBuffer(headerBytes + chunkPcmSize);
    const chunkView = new DataView(chunkBuf);
    const chunkU8 = new Uint8Array(chunkBuf);
    chunkU8.set(new Uint8Array(buf, 0, headerBytes));
    chunkView.setUint32(4, headerBytes - 8 + chunkPcmSize, true);
    chunkView.setUint32(dataOffset - 4, chunkPcmSize, true);
    chunkU8.set(pcmData.subarray(offset, offset + chunkPcmSize), headerBytes);
    chunks.push(chunkBuf);
    offset += chunkPcmSize;
  }
  return chunks;
}

function getMime(ext: string): string {
  const map: Record<string, string> = {
    mp3: "audio/mpeg", mpeg: "audio/mpeg", mpga: "audio/mpeg",
    wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
    webm: "audio/webm", flac: "audio/flac",
    m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac",
  };
  return map[ext] ?? "audio/mpeg";
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

async function transcribeChunk(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string,
  apiKey: string,
  timeOffset: number,
): Promise<Segment[]> {
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), 30_000);
      await new Promise((r) => setTimeout(r, delay));
    }

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), filename);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (fetchErr) {
      lastError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error(`Chunk attempt ${attempt + 1} network error: ${lastError}`);
      continue;
    }

    if (res.ok) {
      const json = await res.json();
      const raw: Array<{ start: number; end: number; text: string }> = json.segments ?? [];
      return raw.map((s) => ({
        start: Math.round((s.start + timeOffset) * 10) / 10,
        end: Math.round((s.end + timeOffset) * 10) / 10,
        text: s.text.trim(),
      }));
    }

    const errText = await res.text();
    lastError = `OpenAI Whisper error (${res.status}): ${errText}`;
    console.error(`Chunk attempt ${attempt + 1} failed: ${lastError}`);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "0", 10);
      if (retryAfter > 0) await new Promise((r) => setTimeout(r, retryAfter * 1000));
    }

    if (!RETRYABLE.has(res.status)) throw new Error(lastError);
  }

  throw new Error(`Failed after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`);
}
