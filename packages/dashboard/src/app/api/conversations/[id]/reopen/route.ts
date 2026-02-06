/**
 * Conversation Reopen API Route
 *
 * Proxies reopen requests to the agent-service.
 * POST /api/conversations/:id/reopen
 * Body: { reason: string }
 * Returns: { reopened: true } on success
 */

import { NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Conversation ID is required" },
      { status: 400 },
    );
  }

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const reason = body.reason?.trim();
  if (!reason) {
    return NextResponse.json({ error: "Reason is required" }, { status: 400 });
  }

  const agentServiceUrl =
    process.env.AGENT_SERVICE_URL ?? "http://localhost:3004";

  try {
    const upstream = await fetch(
      `${agentServiceUrl}/conversations/${id}/reopen`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );

    if (!upstream.ok) {
      const errorBody = await upstream.text();
      return NextResponse.json(
        { error: errorBody || "Upstream error" },
        { status: upstream.status },
      );
    }

    return NextResponse.json({ reopened: true });
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: dashboard convention (no pino logger)
    console.error("Failed to proxy reopen request:", error);
    return NextResponse.json(
      { error: "Failed to connect to agent service" },
      { status: 500 },
    );
  }
}
