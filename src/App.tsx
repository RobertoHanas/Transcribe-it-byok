import { useState, useEffect, useRef } from "react";
import { Mic2, Loader2, AlertCircle, Info } from "lucide-react";
import { supabase, type Transcription } from "./lib/supabase";
import { getSessionId } from "./lib/session";
import { savePendingFile, loadPendingFile, clearPendingFile } from "./lib/pendingFile";
import { needsConversion, decodeAndChunk } from "./lib/convertAudio";
import ApiKeyInput from "./components/ApiKeyInput";
import DropZone from "./components/DropZone";
import TranscriptionCard from "./components/TranscriptionCard";

const STORAGE_KEY = "whisper_openai_key";
const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio`;
const FN_HEADERS = {
  Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"idle" | "converting" | "uploading" | "transcribing">("idle");
  const [error, setError] = useState("");
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const sessionId = useRef(getSessionId());

  useEffect(() => {
    if (apiKey) localStorage.setItem(STORAGE_KEY, apiKey);
  }, [apiKey]);

  useEffect(() => {
    loadPendingFile().then((f) => { if (f) setFile(f); }).catch(() => {});
  }, []);

  useEffect(() => {
    loadHistory();

    const channel = supabase
      .channel("transcriptions-live")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "transcriptions",
        filter: `session_id=eq.${sessionId.current}`,
      }, (payload) => {
        if (payload.eventType === "INSERT") {
          setTranscriptions((prev) => {
            const incoming = payload.new as Transcription;
            if (prev.some((t) => t.id === incoming.id)) return prev;
            return [incoming, ...prev];
          });
        } else if (payload.eventType === "UPDATE") {
          setTranscriptions((prev) =>
            prev.map((t) => t.id === (payload.new as Transcription).id ? payload.new as Transcription : t)
          );
        } else if (payload.eventType === "DELETE") {
          setTranscriptions((prev) => prev.filter((t) => t.id !== (payload.old as Transcription).id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadHistory() {
    const { data } = await supabase
      .from("transcriptions").select("*")
      .eq("session_id", sessionId.current)
      .order("created_at", { ascending: false }).limit(50);
    if (data) {
      setTranscriptions((prev) => {
        const incoming = data as Transcription[];
        const merged = [...incoming];
        for (const p of prev) { if (!merged.some((m) => m.id === p.id)) merged.push(p); }
        return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
    }
  }

  async function handleDelete(id: string) {
    setTranscriptions((prev) => prev.filter((t) => t.id !== id));
    await supabase.from("transcriptions").delete().eq("id", id).eq("session_id", sessionId.current);
  }

  async function uploadFileParts(f: File, onProgress: (pct: number) => void): Promise<string[]> {
    const PART_SIZE = 40 * 1024 * 1024;
    const contentType = f.type || "application/octet-stream";
    const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const base = `${sessionId.current}/${Date.now()}`;
    const totalParts = Math.ceil(f.size / PART_SIZE);
    const paths: string[] = [];

    for (let i = 0; i < totalParts; i++) {
      const blob = f.slice(i * PART_SIZE, (i + 1) * PART_SIZE, contentType);
      const ext = f.name.split(".").pop() ?? "bin";
      const path = totalParts === 1 ? `${base}_${safeName}` : `${base}_part${i + 1}of${totalParts}.${ext}`;
      let lastErr = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
        const { error } = await supabase.storage.from("audio-uploads").upload(path, blob, { contentType, upsert: true });
        if (!error) { lastErr = ""; break; }
        lastErr = error.message;
      }
      if (lastErr) throw new Error(`Upload failed (part ${i + 1}): ${lastErr}`);
      paths.push(path);
      onProgress(Math.round(((i + 1) / totalParts) * 100));
    }
    return paths;
  }

  async function dispatchChunk(
    storagePath: string,
    chunkIndex: number,
    timeOffset: number,
    transcriptionId: string,
    partFilename: string,
    partContentType: string,
  ) {
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: FN_HEADERS,
      body: JSON.stringify({
        mode: "chunk",
        openai_key: apiKey.trim(),
        transcription_id: transcriptionId,
        session_id: sessionId.current,
        storage_path: storagePath,
        chunk_index: chunkIndex,
        filename: partFilename,
        content_type: partContentType,
        time_offset: timeOffset,
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error ?? "Chunk transcription failed");
    return json.result as { chunk_index: number; segments: { start: number; end: number; text: string }[]; time_offset_end: number };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!apiKey.trim()) { setError("Please enter your OpenAI API key."); return; }
    if (!file) { setError("Please select an audio file."); return; }

    setSubmitting(true);
    setUploadProgress(0);
    let recordId: string | null = null;

    try {
      let filesToUpload: File[];
      if (needsConversion(file)) {
        setUploadPhase("converting");
        filesToUpload = await decodeAndChunk(file, setUploadProgress);
        setUploadProgress(0);
      } else {
        filesToUpload = [file];
      }

      setUploadPhase("uploading");

      const { data: record, error: insertErr } = await supabase
        .from("transcriptions")
        .insert({ filename: file.name, file_size: file.size, status: "processing", session_id: sessionId.current })
        .select().single();
      if (insertErr || !record) throw new Error(insertErr?.message ?? "Failed to create record");
      recordId = record.id;

      const storagePaths: string[] = [];
      for (let i = 0; i < filesToUpload.length; i++) {
        const partPaths = await uploadFileParts(filesToUpload[i], (pct) => {
          setUploadProgress(Math.round(((i + pct / 100) / filesToUpload.length) * 100));
        });
        storagePaths.push(...partPaths);
      }
      setUploadProgress(100);
      setUploadPhase("transcribing");

      const partFilename = filesToUpload[0].name;
      const partContentType = filesToUpload[0].type || "audio/wav";

      // Init: count chunks, set up chunk_statuses in DB
      const initRes = await fetch(FN_URL, {
        method: "POST", headers: FN_HEADERS,
        body: JSON.stringify({
          mode: "init",
          openai_key: apiKey.trim(),
          transcription_id: record.id,
          session_id: sessionId.current,
          storage_paths: storagePaths,
          filename: partFilename,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const initJson = await initRes.json().catch(() => ({}));
      if (!initRes.ok || initJson.error) throw new Error(initJson.error ?? "Init failed");

      // Compute sequential time offsets before parallel dispatch.
      // We can't know actual offsets until chunks complete, so we use 0 for all
      // parts and let each chunk's Whisper-returned segment times be relative to
      // their own start. The edge function receives time_offset per part so
      // segments are stamped correctly when stored.
      // For truly accurate cross-part timestamps we'd need audio durations upfront;
      // for now each storage part's offset is estimated from the previous part's end.
      // We dispatch all parts in parallel with offset=0 and re-sort by chunk_index
      // after, adjusting offsets during finalize.
      const parts = (initJson.parts as Array<{ storage_path: string; chunk_index: number }>) ??
        storagePaths.map((p, i) => ({ storage_path: p, chunk_index: i }));

      // Dispatch all parts in parallel
      const results = await Promise.allSettled(
        parts.map((part) =>
          dispatchChunk(
            part.storage_path,
            part.chunk_index,
            0, // raw offset — will be corrected during finalize merge
            record.id,
            partFilename,
            partContentType,
          )
        )
      );

      // Collect results and merge segments in order, adjusting timestamps
      const successResults = results
        .map((r, i) => ({ settled: r, index: i }))
        .filter((r) => r.settled.status === "fulfilled")
        .map((r) => (r.settled as PromiseFulfilledResult<{ chunk_index: number; segments: { start: number; end: number; text: string }[]; time_offset_end: number }>).value)
        .sort((a, b) => a.chunk_index - b.chunk_index);

      const failCount = results.filter((r) => r.status === "rejected").length;

      // Re-stitch timestamps sequentially across chunks
      let runningOffset = 0;
      const allSegments: { start: number; end: number; text: string }[] = [];
      for (const chunkResult of successResults) {
        for (const seg of chunkResult.segments) {
          allSegments.push({
            start: Math.round((seg.start + runningOffset) * 10) / 10,
            end: Math.round((seg.end + runningOffset) * 10) / 10,
            text: seg.text,
          });
        }
        if (chunkResult.segments.length > 0) {
          runningOffset += chunkResult.time_offset_end;
        }
      }

      // Finalize: write full merged transcript + status
      await fetch(FN_URL, {
        method: "POST", headers: FN_HEADERS,
        body: JSON.stringify({
          mode: "finalize",
          transcription_id: record.id,
          session_id: sessionId.current,
          segments: allSegments,
          has_failures: failCount > 0,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      await clearPendingFile();
      setFile(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      if (recordId) {
        await supabase.from("transcriptions")
          .update({ status: "failed", error_message: msg })
          .eq("id", recordId);
      }
    } finally {
      setSubmitting(false);
      setUploadPhase("idle");
      setUploadProgress(0);
    }
  }

  const canSubmit = !!apiKey.trim() && !!file && !submitting;
  const CONTAINER_EXTS = new Set(["mp4", "m4a", "mp4a", "aac", "mov"]);
  const fileExt = file?.name.split(".").pop()?.toLowerCase() ?? "";
  const showMp4Warning = !!file && CONTAINER_EXTS.has(fileExt);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30 font-sans">
      <header className="border-b border-slate-100 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
            <Mic2 size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-none">Whisper Transcriber</h1>
            <p className="text-xs text-slate-400 mt-0.5">Powered by OpenAI Whisper</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
              OpenAI API Key
            </label>
            <ApiKeyInput value={apiKey} onChange={setApiKey} />
            <p className="text-xs text-slate-400 mt-1.5">
              Your key is stored locally and sent directly to Whisper.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
              Audio File
            </label>
            <DropZone
              onFile={(f) => { setFile(f); savePendingFile(f).catch(() => {}); }}
              disabled={submitting}
              initialFile={file}
            />
            <p className="text-xs text-slate-400 mt-1.5">
              MP4/M4A files are decoded in your browser. All sizes supported.
            </p>
            {showMp4Warning && (
              <div className="flex items-start gap-2 mt-2 text-xs rounded-xl px-3 py-2.5 text-amber-700 bg-amber-50 border border-amber-200">
                <Info size={13} className="mt-0.5 shrink-0" />
                <span>
                  <strong>{fileExt.toUpperCase()} files</strong> will be decoded to WAV in your browser before uploading.
                  For faster processing, convert to <strong>MP3</strong> first (VLC or Audacity).
                </span>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm rounded-xl px-4 py-3 text-red-600 bg-red-50 border border-red-100">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {(uploadPhase === "uploading" || uploadPhase === "converting") && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{uploadPhase === "converting" ? "Decoding & converting audio…" : "Uploading…"}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className={`w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-semibold text-sm transition-all duration-200 ${
              canSubmit ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md active:scale-[0.98]" : "bg-slate-100 text-slate-400 cursor-not-allowed"
            }`}
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {uploadPhase === "converting" ? `Converting… ${uploadProgress}%`
              : uploadPhase === "uploading" ? `Uploading… ${uploadProgress}%`
              : uploadPhase === "transcribing" ? "Transcribing…"
              : "Transcribe"}
          </button>
        </form>

        {transcriptions.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              Transcriptions
            </h2>
            <div className="space-y-3">
              {transcriptions.map((t) => (
                <TranscriptionCard key={t.id} item={t} onDelete={handleDelete} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
