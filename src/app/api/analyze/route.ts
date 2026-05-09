import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "Se requiere texto válido." }, { status: 400 });
    }

    // ── 1. OpenRouter – Llama-3.1-8b gratis ─────────────────────────────────
    const t0 = Date.now();

    const openRouterRes = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://animometro.alphadocere.cl",
          "X-Title": "Animómetro Solana",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-3.1-8b-instruct:free",
          messages: [
            {
              role: "system",
              content: `Eres un analizador de sentimiento empático. Responde SOLO con JSON:
{
  "label": "POSITIVO" | "NEGATIVO" | "NEUTRO",
  "score": <0-1>,
  "emoji": "<un emoji>",
  "summary": "<máximo 15 palabras, cálido y directo>",
  "wordSuggestions": ["<w1>","<w2>","<w3>","<w4>","<w5>"]
}
Sin markdown, sin texto extra. El summary debe ser MUY corto (máximo 15 palabras).`,
            },
            {
              role: "user",
              content: `"${text}"`,
            },
          ],
          temperature: 0.3,
          max_tokens: 180,
        }),
      }
    );

    if (!openRouterRes.ok) {
      const err = await openRouterRes.text();
      console.error("OpenRouter error:", err);
      return NextResponse.json({ error: "Error al llamar OpenRouter.", detail: err }, { status: 502 });
    }

    const openRouterData = await openRouterRes.json();
    console.log(`[timing] OpenRouter: ${Date.now() - t0}ms`);

    const rawContent = openRouterData.choices?.[0]?.message?.content ?? "{}";

    let sentiment: {
      label: string;
      score: number;
      emoji: string;
      summary: string;
      wordSuggestions: string[];
    };

    try {
      const clean = rawContent.replace(/```json|```/g, "").trim();
      sentiment = JSON.parse(clean);
    } catch {
      console.error("JSON parse error:", rawContent);
      return NextResponse.json({ error: "Respuesta inesperada del modelo.", raw: rawContent }, { status: 502 });
    }

    // ── 2. ElevenLabs – turbo model ──────────────────────────────────────────
    const t1 = Date.now();

    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: sentiment.summary,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          output_format: "mp3_44100_64",
        }),
      }
    );

    if (!elevenRes.ok) {
      const err = await elevenRes.text();
      console.error("ElevenLabs error:", err);
      return NextResponse.json({ error: "Error al llamar ElevenLabs.", detail: err }, { status: 502 });
    }

    const audioBuffer = await elevenRes.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");
    console.log(`[timing] ElevenLabs: ${Date.now() - t1}ms`);
    console.log(`[timing] Total: ${Date.now() - t0}ms`);

    return NextResponse.json({
      sentiment,
      audio: { base64: audioBase64, mimeType: "audio/mpeg" },
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}
