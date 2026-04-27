// Formats that cannot be byte-range split — must be decoded and re-encoded as WAV.
const CONTAINER_EXTS = new Set(["mp4", "m4a", "mp4a", "aac", "mov"]);

export function needsConversion(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (CONTAINER_EXTS.has(ext)) return true;
  const t = file.type;
  return t === "audio/mp4" || t === "audio/x-m4a" || t === "audio/m4a" || t === "video/mp4";
}

// Target sample rate for Whisper (matches its internal processing rate — minimises WAV size).
const TARGET_SAMPLE_RATE = 16000;

// Target WAV chunk size: stay well under Whisper's 25 MB hard limit and the 40 MB upload limit.
const WAV_CHUNK_BYTES = 18 * 1024 * 1024; // ~18 MB per WAV chunk

// Decode an audio file and return an array of WAV File objects, each ≤ WAV_CHUNK_BYTES.
// Audio is downmixed to mono and resampled to 16 kHz to minimise output size.
export async function decodeAndChunk(
  file: File,
  onProgress: (pct: number) => void
): Promise<File[]> {
  onProgress(5);

  const arrayBuffer = await file.arrayBuffer();
  onProgress(15);

  // Decode using OfflineAudioContext to downsample in one pass
  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();
  onProgress(40);

  // Resample + downmix to mono 16 kHz via OfflineAudioContext
  const numFrames = Math.ceil((decoded.duration * TARGET_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const resampled = await offlineCtx.startRendering();
  onProgress(65);

  const pcm = resampled.getChannelData(0); // Float32Array, mono

  // How many PCM frames fit in one WAV chunk?
  // WAV header = 44 bytes; each frame = 2 bytes (int16)
  const framesPerChunk = Math.floor((WAV_CHUNK_BYTES - 44) / 2);

  const totalFrames = pcm.length;
  const totalChunks = Math.max(1, Math.ceil(totalFrames / framesPerChunk));
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const files: File[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * framesPerChunk;
    const end = Math.min(start + framesPerChunk, totalFrames);
    const slice = pcm.subarray(start, end);
    const wav = encodeWav(slice, TARGET_SAMPLE_RATE);
    const name = totalChunks === 1
      ? `${baseName}.wav`
      : `${baseName}_chunk${i + 1}of${totalChunks}.wav`;
    files.push(new File([wav], name, { type: "audio/wav" }));

    onProgress(65 + Math.round(((i + 1) / totalChunks) * 30));
  }

  onProgress(100);
  return files;
}

function encodeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const numFrames = pcm.length;
  const bytesPerSample = 2;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * bytesPerSample;
  const bufSize = 44 + dataSize;

  const buf = new ArrayBuffer(bufSize);
  const view = new DataView(buf);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, bufSize - 8, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);       // bits per sample
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buf;
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
