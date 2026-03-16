import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8000";

function buildBackendUrl(): URL {
  const backendBaseUrl =
    process.env.ANALYZE_BACKEND_URL ??
    process.env.NEXT_PUBLIC_ANALYZE_BACKEND_URL ??
    DEFAULT_BACKEND_BASE_URL;
  return new URL("/resolve-company", backendBaseUrl);
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }

  try {
    const upstream = await fetch(buildBackendUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("x-api-key")
          ? { "X-API-Key": request.headers.get("x-api-key") as string }
          : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await upstream.text();

    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Company resolution request failed.";

    return new Response(JSON.stringify({ matches: [], error: message }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
