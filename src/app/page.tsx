"use client";

import { useState, useRef } from "react";

type Sentiment = {
  label: "POSITIVO" | "NEGATIVO" | "NEUTRO";
  score: number;
  emoji: string;
  summary: string;
  wordSuggestions: string[];
};

type AnalyzeResponse = {
  sentiment: Sentiment;
  audio: { base64: string; mimeType: string };
  error?: string;
};

type SolanaActionResponse = {
  transaction: string;
  message: string;
  error?: string;
};

// Paso actual del flujo
type Step = "question" | "result" | "word" | "onchain";

const LABEL_COLORS: Record<string, string> = {
  POSITIVO: "#22c55e",
  NEGATIVO: "#ef4444",
  NEUTRO: "#a3a3a3",
};

export default function Home() {
  const [step, setStep] = useState<Step>("question");
  const [text, setText] = useState("");
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Palabra elegida por el usuario para el Memo
  const [chosenWord, setChosenWord] = useState("");
  const [customWord, setCustomWord] = useState("");

  // Solana
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<SolanaActionResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── Paso 1: Analizar respuesta del usuario ─────────────────────────────────
  async function analyze() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data: AnalyzeResponse = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? "Error desconocido");
      } else {
        setResult(data);
        setStep("result");
        if (data.audio?.base64 && audioRef.current) {
          audioRef.current.src = `data:${data.audio.mimeType};base64,${data.audio.base64}`;
          audioRef.current.play();
        }
      }
    } catch (e) {
      setError("No se pudo conectar con la API.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  // ── Paso 2: Confirmar palabra y pasar al Memo ──────────────────────────────
  function confirmWord() {
    const word = customWord.trim() || chosenWord;
    if (!word) return;
    setStep("onchain");
  }

  const finalWord = customWord.trim() || chosenWord;

  // ── Paso 3: Obtener transacción Memo ───────────────────────────────────────
  async function fetchMemoTransaction() {
    if (!result || !finalWord) return;
    setActionLoading(true);
    setActionResult(null);
    setActionError(null);

    const { label, score, emoji } = result.sentiment;
    const memoLabel = `${emoji} ${finalWord} | ${label}`;

    const params = new URLSearchParams({
      name: userName.trim() || "Anónimo",
      sentiment: memoLabel,
      score: score.toFixed(4),
    });

    try {
      const DEMO_ACCOUNT = process.env.NEXT_PUBLIC_DEMO_ACCOUNT ?? "";
      const res = await fetch(`/api/actions/memo?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: DEMO_ACCOUNT }),
      });

      const data = await res.json();
      if (!res.ok || data.message?.includes("Error")) {
        setActionError(data.message ?? "Error al construir la transacción.");
      } else {
        setActionResult(data as SolanaActionResponse);
      }
    } catch (e) {
      setActionError("No se pudo conectar con el endpoint de la Action.");
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  }

  const labelColor = result
    ? (LABEL_COLORS[result.sentiment.label] ?? "#a3a3a3")
    : "#a3a3a3";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-mono">
      <div className="w-full max-w-lg space-y-6">

        {/* Header */}
        <div className="border-b border-zinc-800 pb-4">
          <h1 className="text-xl font-bold tracking-tight text-white">
            ¿Cómo te sientes hoy?
          </h1>
          <p className="text-zinc-600 text-xs mt-1">
            Llama-3 · ElevenLabs · Solana Devnet
          </p>
        </div>

        {/* ── STEP: question ── */}
        {step === "question" && (
          <div className="space-y-3">
            <input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Tu nombre"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Cuéntame cómo estás hoy..."
              rows={4}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md p-3 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500 transition-colors"
            />
            {error && (
              <p className="text-red-400 text-xs">{error}</p>
            )}
            <button
              onClick={analyze}
              disabled={loading || !text.trim()}
              className="w-full bg-white text-zinc-950 font-semibold text-sm py-2.5 rounded-md hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Analizando..." : "Compartir →"}
            </button>
          </div>
        )}

        {/* ── STEP: result ── */}
        {step === "result" && result && (
          <div className="space-y-4">

            {/* Emoji + label */}
            <div
              className="rounded-md px-4 py-4 flex items-center gap-3"
              style={{ backgroundColor: `${labelColor}15`, border: `1px solid ${labelColor}30` }}
            >
              <span className="text-4xl">{result.sentiment.emoji}</span>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest mb-0.5">
                  {result.sentiment.label} · {Math.round(result.sentiment.score * 100)}%
                </p>
                <p className="text-zinc-200 text-sm leading-snug">
                  {result.sentiment.summary}
                </p>
              </div>
            </div>

            {/* Score bar */}
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.round(result.sentiment.score * 100)}%`,
                  backgroundColor: labelColor,
                }}
              />
            </div>

            {/* Audio */}
            <audio ref={audioRef} controls className="w-full" />

            {/* Siguiente paso */}
            <button
              onClick={() => setStep("word")}
              className="w-full border border-zinc-700 text-zinc-300 text-sm py-2.5 rounded-md hover:border-zinc-500 hover:text-white transition-colors"
            >
              Elegir mi palabra → guardar en Solana
            </button>
          </div>
        )}

        {/* ── STEP: word ── */}
        {step === "word" && result && (
          <div className="space-y-4">
            <p className="text-zinc-400 text-sm">
              La IA sugiere estas palabras para describir tu momento. Elige una o escribe la tuya:
            </p>

            {/* Sugerencias */}
            <div className="flex flex-wrap gap-2">
              {result.sentiment.wordSuggestions.map((w) => (
                <button
                  key={w}
                  onClick={() => { setChosenWord(w); setCustomWord(""); }}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    chosenWord === w && !customWord
                      ? "border-white text-white bg-white/10"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {result.sentiment.emoji} {w}
                </button>
              ))}
            </div>

            {/* Palabra propia */}
            <input
              value={customWord}
              onChange={(e) => { setCustomWord(e.target.value); setChosenWord(""); }}
              placeholder="O escribe tu propia palabra..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
            />

            {/* Preview del Memo */}
            {(chosenWord || customWord) && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2">
                <p className="text-zinc-500 text-xs mb-1">Se guardará en Solana como:</p>
                <code className="text-zinc-300 text-sm">
                  {result.sentiment.emoji} {finalWord} | {result.sentiment.label}
                </code>
              </div>
            )}

            <button
              onClick={confirmWord}
              disabled={!finalWord}
              className="w-full bg-white text-zinc-950 font-semibold text-sm py-2.5 rounded-md hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Confirmar palabra →
            </button>

            <button
              onClick={() => setStep("result")}
              className="w-full text-zinc-600 text-xs hover:text-zinc-400 transition-colors"
            >
              ← Volver
            </button>
          </div>
        )}

        {/* ── STEP: onchain ── */}
        {step === "onchain" && result && (
          <div className="space-y-4">

            {/* Resumen de lo que se va a guardar */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 space-y-1">
              <p className="text-zinc-500 text-xs uppercase tracking-widest">Memo on-chain</p>
              <p className="text-white text-lg">
                {result.sentiment.emoji} {finalWord}
              </p>
              <p className="text-zinc-500 text-xs">
                {userName || "Anónimo"} · {result.sentiment.label} · score {Math.round(result.sentiment.score * 100)}%
              </p>
            </div>

            <button
              onClick={fetchMemoTransaction}
              disabled={actionLoading}
              className="w-full border border-zinc-600 text-zinc-200 font-semibold text-sm py-2.5 rounded-md hover:border-zinc-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading ? "Construyendo transacción..." : "⬡ Registrar en Solana Devnet"}
            </button>

            {actionError && (
              <p className="text-red-400 text-xs">{actionError}</p>
            )}

            {actionResult && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-md p-3 space-y-2">
                <p className="text-green-400 text-xs font-semibold">✓ Transacción construida</p>
                <p className="text-zinc-300 text-xs">{actionResult.message}</p>
                <div className="bg-zinc-950 rounded p-2 max-h-20 overflow-y-auto">
                  <code className="text-zinc-500 text-xs break-all">{actionResult.transaction}</code>
                </div>
                <a
                  href="https://explorer.solana.com/?cluster=devnet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-zinc-500 underline hover:text-zinc-300 transition-colors"
                >
                  Ver en Solana Explorer (Devnet) →
                </a>
              </div>
            )}

            {/* Empezar de nuevo */}
            <button
              onClick={() => {
                setStep("question");
                setText("");
                setResult(null);
                setChosenWord("");
                setCustomWord("");
                setActionResult(null);
                setActionError(null);
              }}
              className="w-full text-zinc-600 text-xs hover:text-zinc-400 transition-colors"
            >
              ← Empezar de nuevo
            </button>
          </div>
        )}

      </div>
    </main>
  );
}
