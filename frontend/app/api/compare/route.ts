import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8000";

function buildBackendUrl(): URL {
  const backendBaseUrl =
    process.env.ANALYZE_BACKEND_URL ??
    process.env.NEXT_PUBLIC_ANALYZE_BACKEND_URL ??
    DEFAULT_BACKEND_BASE_URL;
  return new URL("/compare", backendBaseUrl);
}

export async function POST(request: NextRequest) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return new Response("Invalid multipart form data.", {
      status: 400,
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(buildBackendUrl(), {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        ...(request.headers.get("x-api-key")
          ? { "X-API-Key": request.headers.get("x-api-key") as string }
          : {}),
      },
      body: formData,
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Backend comparison request failed.";
    return new Response(
      `event: server-error\ndata: ${message}\n\nevent: done\ndata: \n\n`,
      {
        status: 502,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const errorText = await upstream.text();
    return new Response(errorText || "Backend comparison request failed.", {
      status: upstream.status || 502,
    });
  }

  const reader = upstream.body.getReader();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          return;
        }

        if (value) {
          controller.enqueue(value);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The upstream comparison stream terminated unexpectedly.";
        controller.enqueue(
          encoder.encode(
            `event: server-error\ndata: ${message}\n\nevent: done\ndata: \n\n`,
          ),
        );
        controller.close();
      }
    },
    async cancel() {
      await reader.cancel();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
