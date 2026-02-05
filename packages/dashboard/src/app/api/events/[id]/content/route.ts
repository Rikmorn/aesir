/**
 * Event Content API Route
 *
 * Returns the full LLM response content for an event.
 * Content is stored separately from the lean event log for performance.
 *
 * GET /api/events/:id/content
 * Returns: { content: unknown[] | null }
 */

import { NextResponse } from "next/server";

import { getEventContent } from "@/services/conversations";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Event ID is required" },
      { status: 400 },
    );
  }

  const content = await getEventContent(id);

  return NextResponse.json({ content });
}
