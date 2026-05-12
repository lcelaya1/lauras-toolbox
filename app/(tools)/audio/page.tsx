"use client";

import { useRef, useState } from "react";

type Status = "idle" | "recording" | "finalizing" | "transcribing" | "done" | "error";

const CHUNK_MS = 30_000; // send a chunk every 30 seconds

export default function AudioPage() {
  const [mode, setMode] = useState<"record" | "upload">("record");
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [chunkProcessing, setChunkProcessing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Chunk tracking
  const headerBlobRef = useRef<Blob | null>(null);  // first chunk has WebM headers
  const isFirstChunkRef = useRef(true);
  const accumulatedRef = useRef("");                 // growing transcript text
  const pendingRef = useRef(0);                      // in-flight API calls
  const stoppedRef = useRef(false);                  // recorder stopped?

  const busy = status === "recording" || status === "finalizing" || status === "transcribing";

  // ── Chunk transcription (fires every 30 s while recording) ──────────────
  async function sendChunk(blob: Blob) {
    pendingRef.current++;
    setChunkProcessing(true);
    const form = new FormData();
    form.append("file", blob, "chunk.webm");
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok && data.text?.trim()) {
        const piece = data.text.trim();
        accumulatedRef.current += (accumulatedRef.current ? " " : "") + piece;
        setTranscript(accumulatedRef.current);
      }
    } catch {
      // silent — keep recording even if one chunk fails
    } finally {
      pendingRef.current--;
      if (pendingRef.current === 0) setChunkProcessing(false);
      if (stoppedRef.current && pendingRef.current === 0) setStatus("done");
    }
  }

  // ── Start recording ──────────────────────────────────────────────────────
  async function startRecording() {
    setErrorMsg("");
    setTranscript("");
    accumulatedRef.current = "";
    headerBlobRef.current = null;
    isFirstChunkRef.current = true;
    stoppedRef.current = false;
    pendingRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        if (isFirstChunkRef.current) {
          // First blob contains the WebM init segment — save it and transcribe
          headerBlobRef.current = e.data;
          isFirstChunkRef.current = false;
          sendChunk(e.data);
        } else {
          // Prepend the header so Whisper gets a valid WebM file
          const combined = new Blob([headerBlobRef.current!, e.data], { type: "audio/webm" });
          sendChunk(combined);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        stoppedRef.current = true;
        // If there are still in-flight chunks, wait for them
        if (pendingRef.current === 0) {
          setStatus("done");
        } else {
          setStatus("finalizing");
        }
      };

      recorder.start(CHUNK_MS);
      mediaRecorderRef.current = recorder;
      setStatus("recording");
    } catch {
      setErrorMsg("No se pudo acceder al micrófono. Por favor, concede permiso.");
      setStatus("error");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  // ── File upload (single shot) ────────────────────────────────────────────
  async function transcribeFile(file: File) {
    setStatus("transcribing");
    setTranscript("");
    setErrorMsg("");
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error en la transcripción");
      setTranscript(data.text);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error desconocido");
      setStatus("error");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    transcribeFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files[0];
    if (file) transcribeFile(file);
  }

  async function copy() {
    await navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const showLive = status === "recording" || status === "finalizing";

  return (
    <div className="px-8 py-10 max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🎙</span>
          <h1 className="text-2xl font-semibold text-gray-900">Transcriptor de audio</h1>
        </div>
        <p className="text-sm text-gray-500">Graba o sube un archivo para transcribir en español.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col gap-6">

        {/* Mode tabs */}
        <div className="flex rounded-lg bg-gray-100 p-1 gap-1">
          {(["record", "upload"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { if (!busy) setMode(m); }}
              disabled={busy}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
                ${mode === m
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700 disabled:opacity-40"}`}
            >
              {m === "record" ? "Grabar" : "Subir archivo"}
            </button>
          ))}
        </div>

        {/* Action */}
        <div className="flex flex-col items-center gap-3">
          {mode === "record" ? (
            <>
              <button
                onClick={status === "recording" ? stopRecording : startRecording}
                disabled={status === "finalizing" || status === "transcribing"}
                className={`w-20 h-20 rounded-full flex items-center justify-center text-white
                  shadow-md transition-all active:scale-95 disabled:opacity-40
                  ${status === "recording"
                    ? "bg-red-500 hover:bg-red-400"
                    : "bg-indigo-600 hover:bg-indigo-500"}`}
              >
                {status === "recording" ? (
                  <span className="w-6 h-6 rounded bg-white" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                    <path d="M8 5a4 4 0 018 0v6a4 4 0 01-8 0V5z" />
                    <path d="M6.5 10a.75.75 0 00-1.5 0 7 7 0 0014 0 .75.75 0 00-1.5 0 5.5 5.5 0 01-11 0z" />
                  </svg>
                )}
              </button>

              {/* Status line below button */}
              {status === "idle" && (
                <p className="text-xs text-gray-400">Pulsa para comenzar a grabar</p>
              )}
              {status === "recording" && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-red-500 font-medium">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block" />
                    Grabando
                  </span>
                  {chunkProcessing && (
                    <span className="text-gray-400 flex items-center gap-1">
                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      transcribiendo fragmento…
                    </span>
                  )}
                </div>
              )}
              {status === "finalizing" && (
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Finalizando…
                </span>
              )}
            </>
          ) : (
            <>
              <div
                onClick={() => !busy && fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`w-full rounded-xl border-2 border-dashed px-6 py-10 flex flex-col
                  items-center gap-3 cursor-pointer transition-colors select-none
                  ${dragging ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:border-indigo-300 hover:bg-gray-50"}
                  ${busy ? "opacity-40 pointer-events-none" : ""}`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  className={`w-8 h-8 ${dragging ? "text-indigo-500" : "text-gray-300"}`}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700">
                    {dragging ? "Suelta aquí" : "Arrastra un archivo o haz clic"}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">m4a · mp3 · wav · ogg · webm</p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/mp4,audio/mpeg,audio/wav,audio/ogg,audio/webm,.m4a,.mp3,.wav,.ogg,.webm"
                className="hidden"
                onChange={handleFileChange}
              />
              {status === "transcribing" && (
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Transcribiendo…
                </span>
              )}
            </>
          )}
        </div>

        {/* Error */}
        {status === "error" && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {errorMsg}
          </div>
        )}

        {/* Live transcript (while recording / finalizing) */}
        {showLive && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Transcripción en vivo
              </span>
              {transcript && (
                <button onClick={copy}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200
                    transition-colors text-gray-700 font-medium">
                  {copied ? "✓ Copiado" : "Copiar"}
                </button>
              )}
            </div>
            <textarea
              readOnly
              value={transcript || ""}
              rows={8}
              placeholder="El texto aparecerá aquí cada ~30 segundos…"
              className="w-full rounded-lg bg-gray-50 border border-gray-200 px-4 py-3
                text-sm text-gray-800 resize-y focus:outline-none leading-relaxed
                placeholder:text-gray-300"
            />
          </div>
        )}

        {/* Final transcript */}
        {status === "done" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Transcripción
              </span>
              <button onClick={copy}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200
                  transition-colors text-gray-700 font-medium">
                {copied ? "✓ Copiado" : "Copiar"}
              </button>
            </div>
            <textarea
              readOnly
              value={transcript}
              rows={10}
              className="w-full rounded-lg bg-gray-50 border border-gray-200 px-4 py-3
                text-sm text-gray-800 resize-y focus:outline-none focus:ring-2
                focus:ring-indigo-400 leading-relaxed"
            />
            <button onClick={() => { setStatus("idle"); setTranscript(""); }}
              className="self-start text-xs text-gray-400 hover:text-gray-600 transition-colors mt-1">
              ← Nueva transcripción
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
