import { ACTIONS_CORS_HEADERS } from "@solana/actions";
import { NextRequest } from "next/server";

/**
 * actions.json – Punto de descubrimiento de Solana Actions
 *
 * Debe vivir en /actions.json (raíz del dominio).
 * Mapea rutas de la web a endpoints de Actions.
 * Requiere CORS con Access-Control-Allow-Origin: *
 *
 * Spec: https://solana.com/developers/guides/advanced/actions#actionsjson
 */
export async function GET(_req: NextRequest) {
  const payload = {
    rules: [
      {
        // Cualquier ruta que empiece con /api/actions/* ya es un Action endpoint
        pathPattern: "/api/actions/**",
        apiPath: "/api/actions/**",
      },
      {
        // Ruta raíz → endpoint principal de análisis de sentimiento
        pathPattern: "/",
        apiPath: "/api/actions/memo",
      },
    ],
  };

  return Response.json(payload, { headers: ACTIONS_CORS_HEADERS });
}

export const OPTIONS = GET;
