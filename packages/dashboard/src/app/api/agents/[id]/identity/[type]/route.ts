/**
 * Identity Document Version History API Route
 *
 * Returns paginated version history for a specific identity document type.
 * Used by the client-side IdentityVersionList component for "load more" pagination.
 *
 * GET /api/agents/:id/identity/:type?limit=20&offset=0
 * Returns: { versions: IdentityDocumentVersion[], hasMore: boolean }
 */

import { NextResponse } from "next/server";

import { getIdentityDocumentHistory } from "@/services/agents";

interface RouteParams {
  params: Promise<{ id: string; type: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id, type } = await params;

  if (!id || !type) {
    return NextResponse.json(
      { error: "Agent ID and document type are required" },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 20), 1),
    100,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  const result = await getIdentityDocumentHistory(
    id,
    decodeURIComponent(type),
    limit,
    offset,
  );

  return NextResponse.json(result);
}
