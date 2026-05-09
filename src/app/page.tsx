"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";

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

type Step = "question" | "loading" | "result" | "word" | "onchain";

const LABEL_COLORS: Record<string, string> = {
  POSITIVO: "#22c55e",
  NEGATIVO: "#ef4444",
  NEUTRO: "#a3a3a3",
};

// Mensajes de carga por fase — comunican progreso sin mentir
const LOADING_PHASES = [
  { message: "Leyendo entre líneas...",        duration: 2800 },
  { message: "Entendiendo cómo te sientes...", duration: 2800 },
  { message: "Dándole voz a tu momento...",    duration: 3500 },
  { message: "Casi listo...",                  duration: 99999 },
];

function LoadingScreen() {
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    let i = 0;
    const advance = () => {
      i++;
      if (i < LOADING_PHASES.length) {
        setPhaseIndex(i);
        timer = setTimeout(advance, LOADING_PHASES[i].duration);
      }
    };
    let timer = setTimeout(advance, LOADING_PHASES[0].duration);
    return () => clearTimeout(timer);
  }, []);

  const phase = LOADING_PHASES[phaseIndex];

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12">
      {/* Pulso animado */}
      <div className="relative w-16 h-16 flex items-center justify-center">
        <div className="absolute w-16 h-16 rounded-full bg-zinc-700 animate-ping opacity-20" />
        <div className="absolute w-10 h-10 rounded-full bg-zinc-600 animate-pulse opacity-40" />
        <div className="w-6 h-6 rounded-full bg-zinc-300" />
      </div>

      {/* Mensaje de fase */}
      <p
        key={phase.message}
        className="text-zinc-300 text-sm text-center animate-pulse"
      >
        {phase.message}
      </p>

      {/* Barra de progreso indeterminada */}
      <div className="w-48 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-zinc-400 rounded-full"
          style={{
            animation: "loadbar 1.8s ease-in-out infinite",
          }}
        />
      </div>

      <style>{`
        @keyframes loadbar {
          0%   { transform: translateX(-100%) scaleX(0.4); }
          50%  { transform: translateX(60%)   scaleX(0.8); }
          100% { transform: translateX(200%)  scaleX(0.4); }
        }
      `}</style>
    </div>
  );
}

export default function Home() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [step, setStep] = useState<Step>("question");
  const [text, setText] = useState("");
  const [userName, setUserName] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [chosenWord, setChosenWord] = useState("");
  const [customWord, setCustomWord] = useState("");

  const [txLoading, setTxLoading] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── Análisis ───────────────────────────────────────────────────────────────
  async function analyze() {
    if (!text.trim()) return;
    setStep("loading");
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
        setStep("question");
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
      setStep("question");
      console.error(e);
    }
  }

  const finalWord = customWord.trim() || chosenWord;

  // ── Enviar Memo a Solana ───────────────────────────────────────────────────
  const sendMemo = useCallback(async () => {
    if (!result || !finalWord || !publicKey || !signTransaction) return;

    setTxLoading(true);
    setTxSignature(null);
    setTxError(null);

    try {
      const { label, score, emoji } = result.sentiment;
      const params = new URLSearchParams({
        name: userName.trim() || "Anónimo",
        sentiment: `${emoji} ${finalWord} | ${label}`,
        score: score.toFixed(4),
      });

      const res = await fetch(`/api/actions/memo?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: publicKey.toBase58() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Error construyendo la transacción");
      }

      const { transaction: txBase64 } = await res.json();
      const txBuffer = Buffer.from(txBase64, "base64");
      const transaction = Transaction.from(txBuffer);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });

      setTxSignature(signature);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      setTxError(msg.includes("User rejected") ? "Firmado cancelado." : msg);
    } finally {
      setTxLoading(false);
    }
  }, [result, finalWord, publicKey, signTransaction, connection, userName]);

  const labelColor = result ? (LABEL_COLORS[result.sentiment.label] ?? "#a3a3a3") : "#a3a3a3";

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-mono">
      <div className="w-full max-w-lg space-y-6">

        {/* Header */}
        <div className="border-b border-zinc-800 pb-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">¿Cómo te sientes hoy?</h1>
            <p className="text-zinc-600 text-xs mt-1">Llama-3 · ElevenLabs · Solana Devnet</p>
          </div>
          <WalletMultiButton style={{ fontSize: "12px", height: "36px", padding: "0 14px" }} />
        </div>

        {/* ── LOADING ── */}
        {step === "loading" && <LoadingScreen />}

        {/* ── QUESTION ── */}
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
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              onClick={analyze}
              disabled={!text.trim()}
              className="w-full bg-white text-zinc-950 font-semibold text-sm py-2.5 rounded-md hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Compartir →
            </button>
          </div>
        )}

        {/* ── RESULT ── */}
        {step === "result" && result && (
          <div className="space-y-4">
            <div
              className="rounded-md px-4 py-4 flex items-center gap-3"
              style={{ backgroundColor: `${labelColor}15`, border: `1px solid ${labelColor}30` }}
            >
              <span className="text-4xl">{result.sentiment.emoji}</span>
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest mb-0.5">
                  {result.sentiment.label} · {Math.round(result.sentiment.score * 100)}%
                </p>
                <p className="text-zinc-200 text-sm leading-snug">{result.sentiment.summary}</p>
              </div>
            </div>

            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.round(result.sentiment.score * 100)}%`, backgroundColor: labelColor }}
              />
            </div>

            <audio ref={audioRef} controls className="w-full" />

            <button
              onClick={() => setStep("word")}
              className="w-full border border-zinc-700 text-zinc-300 text-sm py-2.5 rounded-md hover:border-zinc-500 hover:text-white transition-colors"
            >
              Elegir mi palabra → guardar en Solana
            </button>
          </div>
        )}

        {/* ── WORD ── */}
        {step === "word" && result && (
          <div className="space-y-4">
            <p className="text-zinc-400 text-sm">Elige una palabra sugerida o escribe la tuya:</p>

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

            <input
              value={customWord}
              onChange={(e) => { setCustomWord(e.target.value); setChosenWord(""); }}
              placeholder="O escribe tu propia palabra..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
            />

            {finalWord && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2">
                <p className="text-zinc-500 text-xs mb-1">Se guardará en Solana como:</p>
                <code className="text-zinc-300 text-sm">
                  {result.sentiment.emoji} {finalWord} | {result.sentiment.label}
                </code>
              </div>
            )}

            <button
              onClick={() => finalWord && setStep("onchain")}
              disabled={!finalWord}
              className="w-full bg-white text-zinc-950 font-semibold text-sm py-2.5 rounded-md hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Confirmar →
            </button>

            <button onClick={() => setStep("result")} className="w-full text-zinc-600 text-xs hover:text-zinc-400 transition-colors">
              ← Volver
            </button>
          </div>
        )}

        {/* ── ONCHAIN ── */}
        {step === "onchain" && result && (
          <div className="space-y-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 space-y-1">
              <p className="text-zinc-500 text-xs uppercase tracking-widest">Memo on-chain</p>
              <p className="text-white text-2xl">{result.sentiment.emoji} {finalWord}</p>
              <p className="text-zinc-500 text-xs">
                {userName || "Anónimo"} · {result.sentiment.label} · {Math.round(result.sentiment.score * 100)}%
              </p>
            </div>

            {!connected && (
              <div className="bg-zinc-900 border border-yellow-900/50 rounded-md px-4 py-3 space-y-2">
                <p className="text-yellow-400 text-xs">Conecta tu wallet para firmar</p>
                <WalletMultiButton style={{ fontSize: "12px", height: "32px", width: "100%" }} />
              </div>
            )}

            {connected && publicKey && (
              <p className="text-zinc-500 text-xs">
                Wallet: <span className="text-zinc-300">{publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-6)}</span>
              </p>
            )}

            <button
              onClick={sendMemo}
              disabled={txLoading || !connected || !!txSignature}
              className="w-full border border-zinc-600 text-zinc-200 font-semibold text-sm py-2.5 rounded-md hover:border-zinc-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {txLoading ? "Esperando firma..." : txSignature ? "✓ Guardado" : "⬡ Firmar y enviar a Solana"}
            </button>

            {txError && <p className="text-red-400 text-xs">{txError}</p>}

            {txSignature && (
              <div className="bg-zinc-900 border border-green-900/50 rounded-md p-3 space-y-2">
                <p className="text-green-400 text-xs font-semibold">✓ Confirmado en Devnet</p>
                <a
                  href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-zinc-400 underline hover:text-white transition-colors"
                >
                  Ver en Solana Explorer →
                </a>
              </div>
            )}

            <button
              onClick={() => {
                setStep("question"); setText(""); setResult(null);
                setChosenWord(""); setCustomWord("");
                setTxSignature(null); setTxError(null);
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
