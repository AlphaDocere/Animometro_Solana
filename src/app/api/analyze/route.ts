import { NextRequest, NextResponse } from "next/server";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY!;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "Se requiere texto válido." }, { status: 400 });
    }

    // ── 1. NVIDIA NIM – Llama-3: sentimiento + palabras sugeridas ───────────
    const nvidiaRes = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-8b-instruct",
          messages: [
            {
              role: "system",
              content: `Eres un analizador de sentimiento empático. Responde SOLO con un objeto JSON con esta forma exacta:
{
  "label": "POSITIVO" | "NEGATIVO" | "NEUTRO",
  "score": <número entre 0 y 1>,
  "emoji": "<un solo emoji que represente el estado emocional>",
  "summary": "<una oración breve y cálida explicando el sentimiento>",
  "wordSuggestions": ["<palabra1>", "<palabra2>", "<palabra3>", "<palabra4>", "<palabra5>"]
}
Las wordSuggestions deben ser sustantivos o adjetivos de una sola palabra en español que capturen la esencia emocional del texto. Ejemplos: "Esperanzado", "Agotado", "Tranquilo", "Ansioso", "Agradecido".
Sin markdown, sin texto extra.`,
            },
            {
              role: "user",
              content: `Analiza el sentimiento de esta respuesta a "¿Cómo te sientes hoy?": "${text}"`,
            },
          ],
          temperature: 0.4,
          max_tokens: 300,
        }),
      }
    );

    if (!nvidiaRes.ok) {
      const err = await nvidiaRes.text();
      console.error("NVIDIA NIM error:", err);
      return NextResponse.json({ error: "Error al llamar NVIDIA NIM.", detail: err }, { status: 502 });
    }

    const nvidiaData = await nvidiaRes.json();
    const rawContent = nvidiaData.choices?.[0]?.message?.content ?? "{}";

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
      console.error("JSON parse error from NIM:", rawContent);
      return NextResponse.json({ error: "Respuesta inesperada de NIM.", raw: rawContent }, { status: 502 });
    }

    // ── 2. ElevenLabs – audio con el resumen empático ───────────────────────
    const ttsText = `${sentiment.summary}`;

    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: ttsText,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
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

    return NextResponse.json({
      sentiment,
      audio: { base64: audioBase64, mimeType: "audio/mpeg" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}
