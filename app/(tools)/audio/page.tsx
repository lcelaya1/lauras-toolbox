"use client";

import { useRef, useState } from "react";

type Status = "idle" | "transcribing" | "done" | "error";

export default function AudioPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFileRef = useRef<{ blob: Blob; name: string; mimeType: string } | null>(null);

  const busy = status === "transcribing";

  async function transcribeFile(file: File) {
    setStatus("transcribing");
    setTranscript("");
    setSaved(false);
    setErrorMsg("");
    currentFileRef.current = { blob: file, name: file.name, mimeType: file.type };
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

  async function handleSave() {
    const f = currentFileRef.current;
    if (!f) return;
    const form = new FormData();
    form.append("file", f.blob, f.name);
    form.append("name", f.name);
    form.append("transcript", transcript);
    await fetch("/api/recordings", { method: "POST", body: form });
    setSaved(true);
  }

  return (
    <div className="px-8 py-10 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🎙</span>
          <h1 className="text-2xl font-semibold text-gray-900">Transcriptor de audio</h1>
        </div>
        <p className="text-sm text-gray-500">Sube un archivo de audio para transcribir en español.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col gap-6">

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
            <p className="text-sm font-medium text-gray-700">{dragging ? "Suelta aquí" : "Arrastra un archivo o haz clic"}</p>
            <p className="text-xs text-gray-400 mt-0.5">m4a · mp3 · wav · ogg · webm</p>
          </div>
        </div>
        <input ref={fileInputRef} type="file"
          accept="audio/mp4,audio/mpeg,audio/wav,audio/ogg,audio/webm,.m4a,.mp3,.wav,.ogg,.webm"
          className="hidden" onChange={handleFileChange} />

        {status === "transcribing" && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Transcribiendo…
          </span>
        )}

        {status === "error" && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{errorMsg}</div>
        )}

        {status === "done" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Transcripción</span>
              <div className="flex items-center gap-2">
                <button onClick={copy} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-700 font-medium">
                  {copied ? "✓ Copiado" : "Copiar"}
                </button>
                <button onClick={handleSave} disabled={saved}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
                    ${saved ? "bg-green-100 text-green-700 cursor-default" : "bg-indigo-600 hover:bg-indigo-500 text-white"}`}>
                  {saved ? "✓ Guardada" : "Guardar grabación"}
                </button>
              </div>
            </div>
            <textarea readOnly value={transcript} rows={10}
              className="w-full rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-800 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400 leading-relaxed" />
            <button onClick={() => { setStatus("idle"); setTranscript(""); setSaved(false); }}
              className="self-start text-xs text-gray-400 hover:text-gray-600 transition-colors mt-1">
              ← Nueva transcripción
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
