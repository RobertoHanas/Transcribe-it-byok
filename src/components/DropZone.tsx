import { useRef, useState, useEffect, DragEvent } from "react";
import { Upload, FileAudio } from "lucide-react";

const ACCEPTED = ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm", "audio/flac", "audio/x-m4a", "audio/m4a", "video/mp4", "video/webm"];

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
  initialFile?: File | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DropZone({ onFile, disabled, initialFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<File | null>(initialFile ?? null);

  useEffect(() => {
    if (initialFile && !selected) setSelected(initialFile);
  }, [initialFile]);

  function handleFile(file: File) {
    setSelected(file);
    onFile(file);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`
        relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed
        px-8 py-12 text-center cursor-pointer transition-all select-none
        ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-blue-400 hover:bg-blue-50/50"}
        ${dragging ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-slate-50/50"}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        onChange={onInputChange}
        className="hidden"
        disabled={disabled}
      />

      {selected ? (
        <>
          <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center">
            <FileAudio size={28} className="text-blue-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-800 text-sm truncate max-w-xs">{selected.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">{formatBytes(selected.size)}</p>
          </div>
{!disabled && (
            <p className="text-xs text-slate-400">Click to change file</p>
          )}
        </>
      ) : (
        <>
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Upload size={28} className="text-slate-400" />
          </div>
          <div>
            <p className="font-semibold text-slate-700 text-sm">Drop your audio file here</p>
            <p className="text-xs text-slate-400 mt-1">or click to browse</p>
          </div>
          <p className="text-xs text-slate-400">MP3, MP4, WAV, OGG, FLAC, M4A, WebM supported</p>
        </>
      )}
    </div>
  );
}
