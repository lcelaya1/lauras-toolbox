"use client";

import { useRef, useState } from "react";

type Status = "idle" | "recording" | "transcribing" | "done" | "error";

export default function AudioPage() {
  const [mode, setMode] = useState<"record" | "upload">("record");
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const [dragging, setDragging] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = status === "recording" || status === "transcribing";

  async function transcribe(blob: Blob, filename: string) {
    setStatus("transcribing");
    setTranscript("");
    setErrorMsg("");
    const form = new FormData();
    form.append("file", blob, filename);
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transcription failed");
      setTranscript(data.text);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error desconocido");
      setStatus("error");
    }
  }

  async function startRecording() {
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        transcribe(new Blob(chunksRef.current, { type: "audio/webm" }), "recording.webm");
      };
      recorder.start();
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

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files[0];
    if (file) transcribe(file, file.name);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    transcribe(file, file.name);
    e.target.value = "";
  }

  async function copy() {
    await navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
        <div className="flex flex-col items-center gap-4 py-4">
          {mode === "record" ? (
            <>
              <button
                onClick={status === "recording" ? stopRecording : startRecording}
                disabled={status === "transcribing"}
                className={`w-20 h-20 rounded-full flex items-center justify-center text-white
                  text-2xl shadow-md transition-all active:scale-95 disabled:opacity-40
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
              <p className="text-xs text-gray-400">
                {status === "recording"
                  ? "Grabando… pulsa para detener"
                  : "Pulsa para comenzar a grabar"}
              </p>
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
                  ${dragging
                    ? "border-indigo-400 bg-indigo-50"
                    : "border-gray-200 hover:border-indigo-300 hover:bg-gray-50"}
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
            </>
          )}

          {status === "recording" && (
            <span className="flex items-center gap-1.5 text-xs text-red-500">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block" />
              En curso
            </span>
          )}
          {status === "transcribing" && (
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Transcribiendo…
            </span>
          )}
        </div>

        {/* Error */}
        {status === "error" && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {errorMsg}
          </div>
        )}

        {/* Result */}
        {status === "done" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Transcripción</span>
              <button
                onClick={copy}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200
                  transition-colors text-gray-700 font-medium"
              >
                {copied ? "✓ Copiado" : "Copiar"}
              </button>
            </div>
            <textarea
              readOnly
              value={transcript}
              rows={8}
              className="w-full rounded-lg bg-gray-50 border border-gray-200 px-4 py-3
                text-sm text-gray-800 resize-y focus:outline-none focus:ring-2
                focus:ring-indigo-400 leading-relaxed"
            />
            <button
              onClick={() => setStatus("idle")}
              className="self-start text-xs text-gray-400 hover:text-gray-600 transition-colors mt-1"
            >
              ← Nueva transcripción
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
