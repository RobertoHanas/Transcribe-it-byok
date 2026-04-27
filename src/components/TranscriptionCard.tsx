import { useState, useEffect } from "react";
import {
  Copy, Check, FileAudio, AlertCircle, Loader2,
  ChevronDown, ChevronUp, Clock, Trash2, CheckCircle2,
  XCircle, Circle,
} from "lucide-react";
import type { Transcription, ChunkStatus } from "../lib/supabase";

interface Props {
  item: Transcription;
  onDelete: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function useElapsed(startIso: string, active: boolean): string {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = new Date(startIso).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startIso, active]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ChunkPill({ cs, index }: { cs: ChunkStatus | undefined; index: number }) {
  const status = cs?.status ?? "pending";
  const label = `Part ${index + 1}`;

  const styles: Record<string, string> = {
    pending:    "bg-slate-100 text-slate-400 border-slate-200",
    processing: "bg-blue-50 text-blue-600 border-blue-200",
    completed:  "bg-green-50 text-green-700 border-green-200",
    failed:     "bg-red-50 text-red-600 border-red-200",
  };

  const icons: Record<string, React.ReactNode> = {
    pending:    <Circle size={10} className="shrink-0" />,
    processing: <Loader2 size={10} className="shrink-0 animate-spin" />,
    completed:  <CheckCircle2 size={10} className="shrink-0" />,
    failed:     <XCircle size={10} className="shrink-0" />,
  };

  return (
    <div
      title={cs?.error ?? status}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium ${styles[status] ?? styles.pending}`}
    >
      {icons[status] ?? icons.pending}
      {label}
    </div>
  );
}

export default function TranscriptionCard({ item, onDelete }: Props) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasSegments = item.segments && item.segments.length > 0;
  const isProcessing = item.status === "processing";
  const elapsed = useElapsed(item.created_at, isProcessing);

  const progressPct = item.chunks_total > 0
    ? Math.round((item.chunks_done / item.chunks_total) * 100)
    : null;

  const chunkStatuses: ChunkStatus[] = item.chunk_statuses ?? [];
  const totalParts = Math.max(
    chunkStatuses.length,
    item.chunks_total > 0 ? item.chunks_total : 0
  );

  async function copy() {
    const text = hasSegments && showTimestamps
      ? item.segments!.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`).join("\n")
      : item.transcript;
    await navigator.clipboard.writeText(text ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDeleteClick() {
    if (confirmDelete) {
      onDelete(item.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  const statusColor = {
    completed: "bg-green-100",
    failed: "bg-red-100",
    processing: "bg-blue-100",
  }[item.status] ?? "bg-slate-100";

  const statusIcon = isProcessing
    ? <Loader2 size={16} className="text-blue-600 animate-spin" />
    : item.status === "failed"
    ? <AlertCircle size={16} className="text-red-500" />
    : <FileAudio size={16} className="text-green-600" />;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden transition-all">

      {/* ── Job header ── */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${statusColor}`}>
          {statusIcon}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{item.filename}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {formatBytes(item.file_size)} · {formatDate(item.created_at)}
            {hasSegments && (
              <>
                <span className="mx-1 text-slate-300">·</span>
                <span>{formatTimestamp(item.segments![item.segments!.length - 1].end)} audio</span>
              </>
            )}
            {isProcessing && (
              <>
                <span className="mx-1 text-slate-300">·</span>
                <span className="text-blue-500 tabular-nums">{elapsed}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isProcessing && hasSegments && (
            <button
              onClick={() => setShowTimestamps((v) => !v)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                showTimestamps ? "bg-blue-100 text-blue-700 hover:bg-blue-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              <Clock size={11} />
              {showTimestamps ? "TS on" : "TS off"}
            </button>
          )}
          {!isProcessing && (item.transcript || hasSegments) && (
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            >
              {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          <button
            onClick={handleDeleteClick}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
              confirmDelete
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-500"
            }`}
          >
            <Trash2 size={12} />
            {confirmDelete ? "Confirm" : "Delete"}
          </button>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100">

          {/* ── Chunk grid ── */}
          {totalParts > 0 && (
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500">
                  {isProcessing
                    ? `Processing — ${item.chunks_done} of ${item.chunks_total} chunks`
                    : `${item.chunks_done} of ${item.chunks_total} chunks`}
                </span>
                {progressPct !== null && (
                  <span className="text-xs tabular-nums text-slate-400">{progressPct}%</span>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mb-3">
                {progressPct !== null ? (
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${
                      item.status === "failed" ? "bg-red-400" : "bg-blue-500"
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 bg-blue-400 rounded-full animate-pulse" />
                )}
              </div>

              {/* Chunk pills */}
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: totalParts }, (_, i) => {
                  const cs = chunkStatuses.find((c) => c.storage_index === i);
                  return <ChunkPill key={i} cs={cs} index={i} />;
                })}
              </div>
            </div>
          )}

          {/* ── Body ── */}
          <div className="px-5 py-4">
            {item.status === "failed" && item.error_message && (
              <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 mb-3">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{item.error_message}</span>
              </div>
            )}

            {isProcessing && !hasSegments && (
              <p className="text-xs text-slate-400 italic">Transcript will appear here as chunks complete…</p>
            )}

            {hasSegments && showTimestamps ? (
              <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
                {item.segments!.map((seg, i) => (
                  <div key={i} className="flex gap-3 group">
                    <span className="text-xs font-mono text-slate-400 pt-0.5 shrink-0 w-12 text-right tabular-nums">
                      {formatTimestamp(seg.start)}
                    </span>
                    <p className="text-sm text-slate-700 leading-relaxed">{seg.text}</p>
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex gap-3 items-center pt-1">
                    <span className="w-12 shrink-0" />
                    <span className="flex gap-1">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </span>
                  </div>
                )}
              </div>
            ) : item.transcript ? (
              <div>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {item.transcript}
                </p>
                {isProcessing && (
                  <div className="flex gap-1 mt-2">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {item.status === "completed" && !item.transcript && !hasSegments && (
              <p className="text-sm text-slate-400 italic">No transcript returned.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
