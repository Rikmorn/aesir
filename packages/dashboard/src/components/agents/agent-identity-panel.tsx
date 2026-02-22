"use client";

/**
 * AgentIdentityPanel
 *
 * Container component for the Identity section on the agent detail page.
 * Renders a header and one IdentityDocumentCard per document.
 *
 * Placed in the sidebar below AgentSchedulePanel, following the same
 * layout pattern: uppercase header + card list.
 */

import type { IdentityDocumentSummary } from "@/services/agents";
import { IdentityDocumentCard } from "./identity-document-card";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentIdentityPanelProps {
  agentId: string;
  documents: IdentityDocumentSummary[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentIdentityPanel({
  agentId,
  documents,
}: AgentIdentityPanelProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Identity
      </h3>
      {documents.map((doc) => (
        <IdentityDocumentCard
          key={doc.documentType}
          document={doc}
          agentId={agentId}
        />
      ))}
    </div>
  );
}
