import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8000";

function buildBackendUrl(request: NextRequest): URL {
  const backendBaseUrl =
    process.env.ANALYZE_BACKEND_URL ?? DEFAULT_BACKEND_BASE_URL;
  const url = new URL("/analyze", backendBaseUrl);

  const company = request.nextUrl.searchParams.get("company");
  const analysisRequest = request.nextUrl.searchParams.get("request");
  const companyUrl = request.nextUrl.searchParams.get("company_url");

  if (company) {
    url.searchParams.set("company", company);
  }

  if (analysisRequest) {
    url.searchParams.set("request", analysisRequest);
  }

  if (companyUrl) {
    url.searchParams.set("company_url", companyUrl);
  }

  return url;
}

export async function GET(request: NextRequest) {
  const company = request.nextUrl.searchParams.get("company");
  const analysisRequest = request.nextUrl.searchParams.get("request");

  if (!company || !analysisRequest) {
    return new Response("Missing company or request query parameter.", {
      status: 400,
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(buildBackendUrl(request), {
      headers: {
        Accept: "text/event-stream",
      },
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Backend stream request failed.";
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
    return new Response(errorText || "Backend stream request failed.", {
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
            : "The upstream analysis stream terminated unexpectedly.";
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
