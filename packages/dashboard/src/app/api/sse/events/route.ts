/**
 * SSE Proxy API Route
 *
 * Proxies EventSource requests from the browser to the agent-service
 * SSE endpoint. Avoids cross-origin issues and simplifies the client
 * connection URL (browser connects to /dashboard/api/sse/events).
 *
 * Forwards:
 * - All searchParams (?types=, ?conversationId=) to the upstream
 * - Last-Event-ID header for reconnection replay
 * - lastEventId query param (for initial connections with stored ID)
 * - Client disconnect signal (request.signal aborts the upstream fetch)
 *
 * The agent-service SSE endpoint sends keepalive pings every 20s,
 * which flow through this proxy transparently.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const agentServiceUrl =
    process.env.AGENT_SERVICE_URL ?? "http://localhost:3004";

  const { searchParams } = new URL(request.url);

  // Build the upstream URL, forwarding all query params
  const targetUrl = `${agentServiceUrl}/api/sse/events?${searchParams.toString()}`;

  // Forward Last-Event-ID header if present (native EventSource reconnection)
  const headers: Record<string, string> = {};
  const lastEventId = request.headers.get("Last-Event-ID");
  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }

  // Also check for lastEventId query param (initial connection with stored ID)
  const lastEventIdParam = searchParams.get("lastEventId");
  if (lastEventIdParam && !lastEventId) {
    headers["Last-Event-ID"] = lastEventIdParam;
  }

  try {
    const response = await fetch(targetUrl, {
      headers,
      signal: request.signal,
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "SSE upstream error",
          status: response.status,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Stream the SSE response directly through to the client
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    // AbortError is expected when the client disconnects -- not an error
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }

    // biome-ignore lint/suspicious/noConsole: Server-side proxy needs error logging for debugging unreachable agent-service
    console.error("[sse-proxy] Failed to connect to agent-service:", error);

    return new Response(JSON.stringify({ error: "SSE upstream unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
