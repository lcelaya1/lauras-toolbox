"use client";

import { useRef, useState } from "react";

interface AudioFile {
  id: string;
  name: string;
  file: File;
  wantsTranscript: boolean;
  status: "idle" | "transcribing" | "done" | "error";
  transcript: string;
  error: string;
  saved: boolean;
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
        ${on ? "bg-indigo-600" : "bg-gray-200"}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform
        ${on ? "translate-x-4" : "translate-x-1"}`} />
    </button>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-indigo-400 shrink-0">
      <path d="M10 2a1 1 0 00-.707.293l-4 4A1 1 0 005 7v9a1 1 0 001 1h8a1 1 0 001-1V7a1 1 0 00-.293-.707l-4-4A1 1 0 0010 2zm0 2.414L13.586 8H11a1 1 0 01-1-1V4.414z" />
    </svg>
  );
}

export default function AudioPage() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function transcribeFile(id: string, file: File) {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "transcribing" } : f))
    );
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error en la transcripción");
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: "done", transcript: data.text } : f))
      );
    } catch (err) {
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: "error", error: err instanceof Error ? err.message : "Error desconocido" } : f))
      );
    }
  }

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    const added: AudioFile[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ""),
      file,
      wantsTranscript: true,
      status: "idle" as const,
      transcript: "",
      error: "",
      saved: false,
    }));
    setFiles((prev) => [...prev, ...added]);
    if (added.length > 0 && !selectedId) setSelectedId(added[0].id);
    added.forEach((f) => { if (f.wantsTranscript) transcribeFile(f.id, f.file); });
  }

  function toggleTranscript(id: string) {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const next = !f.wantsTranscript;
        if (next && f.status === "idle") transcribeFile(id, f.file);
        return { ...f, wantsTranscript: next };
      })
    );
  }

  async function handleSave(af: AudioFile) {
    const form = new FormData();
    form.append("file", af.file, af.name);
    form.append("name", af.name);
    form.append("transcript", af.transcript);
    await fetch("/api/recordings", { method: "POST", body: form });
    setFiles((prev) => prev.map((f) => (f.id === af.id ? { ...f, saved: true } : f)));
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const incoming = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("audio/") || /\.(m4a|mp3|wav|ogg|webm)$/i.test(f.name));
    if (incoming.length) addFiles(incoming);
  }

  const selected = files.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="flex h-full">

      {/* ── Left panel ── */}
      <div className="w-72 shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col">
        {/* Upload button */}
        <div className="p-4 border-b border-gray-100">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
              bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636v8.614z" />
              <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
            </svg>
            Subir audio
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="audio/mp4,audio/mpeg,audio/wav,audio/ogg,audio/webm,.m4a,.mp3,.wav,.ogg,.webm"
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ""; } }}
          />
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto py-2">
          {files.length === 0 ? (
            <p className="text-xs text-gray-400 text-center mt-8 px-4">Sube un archivo para empezar</p>
          ) : (
            files.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors
                  ${selectedId === f.id ? "bg-indigo-50 border-r-2 border-indigo-500" : "hover:bg-gray-100"}`}
              >
                <FileIcon />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {f.status === "transcribing" && (
                      <span className="flex items-center gap-1 text-[10px] text-indigo-500">
                        <svg className="animate-spin h-2.5 w-2.5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Transcribiendo…
                      </span>
                    )}
                    {f.status === "done" && <span className="text-[10px] text-green-500 font-medium">✓ Listo</span>}
                    {f.status === "error" && <span className="text-[10px] text-red-400">Error</span>}
                    {f.status === "idle" && <span className="text-[10px] text-gray-400">Sin transcribir</span>}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div
        className="flex-1 flex flex-col overflow-hidden"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {dragging ? (
          <div className="flex-1 m-6 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50
            flex flex-col items-center justify-center gap-3 pointer-events-none">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-10 h-10 text-indigo-400">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm font-medium text-indigo-600">Suelta el archivo aquí</p>
          </div>
        ) : !selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                className="w-8 h-8 text-gray-300">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Sube un audio para empezar</p>
              <p className="text-xs text-gray-400 mt-1">m4a · mp3 · wav · ogg · webm</p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-sm px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500
                text-white font-medium transition-colors"
            >
              Subir archivo
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between gap-4 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900 truncate">{selected.name}</h2>
              </div>
              <div className="flex items-center gap-6 shrink-0">
                {/* Transcription toggle */}
                <div className="flex items-center gap-2.5">
                  <span className="text-xs text-gray-500 font-medium">Transcribir</span>
                  <Toggle on={selected.wantsTranscript} onChange={() => toggleTranscript(selected.id)} />
                </div>
                {/* Actions */}
                {selected.status === "done" && selected.transcript && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copy(selected.transcript)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200
                        transition-colors text-gray-600 font-medium"
                    >
                      {copied ? "✓ Copiado" : "Copiar"}
                    </button>
                    <button
                      onClick={() => handleSave(selected)}
                      disabled={selected.saved}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
                        ${selected.saved
                          ? "bg-green-100 text-green-700 cursor-default"
                          : "bg-indigo-600 hover:bg-indigo-500 text-white"}`}
                    >
                      {selected.saved ? "✓ Guardada" : "Guardar"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              {!selected.wantsTranscript && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <p className="text-sm text-gray-500">Transcripción desactivada para este archivo.</p>
                  <button
                    onClick={() => toggleTranscript(selected.id)}
                    className="text-xs px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                  >
                    Activar transcripción
                  </button>
                </div>
              )}
              {selected.wantsTranscript && selected.status === "idle" && (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-gray-400">Iniciando transcripción…</p>
                </div>
              )}
              {selected.wantsTranscript && selected.status === "transcribing" && (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <svg className="animate-spin h-6 w-6 text-indigo-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <p className="text-sm text-gray-500">Transcribiendo…</p>
                </div>
              )}
              {selected.wantsTranscript && selected.status === "error" && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-5 py-4 text-sm text-red-600">
                  {selected.error}
                </div>
              )}
              {selected.wantsTranscript && selected.status === "done" && (
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {selected.transcript}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
