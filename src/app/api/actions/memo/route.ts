/**
 * Solana Action – Sentiment Memo
 *
 * Cumple con el estándar de Solana Actions:
 *  GET  → metadatos de la acción (icon, title, description, inputs)
 *  POST → transacción Memo firmable (base64) con nombre + sentimiento
 *  OPTIONS → headers CORS para preflight
 *
 * Referencia: https://solana.com/developers/guides/advanced/actions
 */

import {
  ACTIONS_CORS_HEADERS,
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  createPostResponse,
} from "@solana/actions";

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
} from "@solana/web3.js";

// ── Constantes ───────────────────────────────────────────────────────────────

/** Devnet RPC público de Solana */
const SOLANA_RPC = clusterApiUrl("devnet");

/**
 * Program ID del Memo Program v2 en Mainnet / Devnet
 * https://spl.solana.com/memo
 */
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Valida y extrae los query params del POST.
 * Esperamos: ?name=<string>&sentiment=<POSITIVO|NEGATIVO|NEUTRO>&score=<0-1>
 */
function parseParams(url: URL): {
  name: string;
  sentiment: string;
  score: string;
} {
  const name = (url.searchParams.get("name") ?? "Anónimo").slice(0, 50);
  const sentiment = url.searchParams.get("sentiment") ?? "NEUTRO";
  const score = url.searchParams.get("score") ?? "0";
  return { name, sentiment, score };
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseHref = `${url.origin}${url.pathname}`;

  const payload: ActionGetResponse = {
    // Icono: se sirve desde /public. Usa URL absoluta (requerido por el spec).
    icon: `${url.origin}/solana-action-icon.svg`,
    title: "Registrar Sentimiento en Solana",
    description:
      "Guarda tu nombre y el sentimiento analizado por NVIDIA Llama-3 como un Memo inmutable en Solana Devnet.",
    label: "Registrar en Devnet",
    // Input libre para el nombre del usuario
    links: {
      actions: [
        {
          // Tipo requerido por ActionGetResponse – "transaction" es el default
          type: "transaction",
          label: "Registrar Sentimiento",
          // El href incluirá name/sentiment/score como query params cuando
          // el frontend los pase. El cliente los añade antes del POST.
          href: `${baseHref}?name={name}&sentiment={sentiment}&score={score}`,
          parameters: [
            {
              name: "name",
              label: "Tu nombre",
              required: true,
            },
            {
              name: "sentiment",
              label: "Sentimiento (POSITIVO / NEGATIVO / NEUTRO)",
              required: true,
            },
            {
              name: "score",
              label: "Score (0 a 1)",
              required: false,
            },
          ],
        },
      ],
    },
  };

  return Response.json(payload, { headers: ACTIONS_CORS_HEADERS });
}

// OPTIONS = GET  → mismos headers CORS para el preflight
export const OPTIONS = GET;

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    // 1. Leer account del body (requerido por el spec)
    const body: ActionPostRequest = await req.json();

    let feePayer: PublicKey;
    try {
      feePayer = new PublicKey(body.account);
    } catch {
      return Response.json(
        { message: 'El campo "account" no es una clave pública válida.' },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    // 2. Extraer parámetros de la URL
    const url = new URL(req.url);
    const { name, sentiment, score } = parseParams(url);

    // 3. Construir el contenido del Memo
    //    Formato legible e indexable: [AlphaDocere] nombre | SENTIMIENTO | score
    const memoText = `[AlphaDocere] ${name} | ${sentiment} | score:${parseFloat(score).toFixed(2)}`;

    // 4. Conectar a Devnet y obtener el blockhash reciente
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    // 5. Construir la instrucción Memo
    //    El Memo Program registra cualquier texto UTF-8 on-chain.
    //    El feePayer firma como signer para que el memo sea atribuido.
    const memoInstruction = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [
        {
          pubkey: feePayer,
          isSigner: true,
          isWritable: false,
        },
      ],
      data: Buffer.from(memoText, "utf-8"),
    });

    // 6. Construir la transacción
    const transaction = new Transaction({
      feePayer,
      blockhash,
      lastValidBlockHeight,
    }).add(memoInstruction);

    // 7. Serializar con createPostResponse (helper oficial de @solana/actions)
    //    Devuelve { transaction: base64, message: string } spec-compliant.
    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction",
        transaction,
        message: `Sentimiento "${sentiment}" de ${name} registrado en Solana Devnet 🧠`,
      },
      // signers: [] – la transacción la firma solo el usuario (fee payer)
    });

    return Response.json(payload, { headers: ACTIONS_CORS_HEADERS });
  } catch (err) {
    console.error("[Action /memo POST]", err);
    return Response.json(
      { message: "Error interno al construir la transacción." },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    );
  }
}
