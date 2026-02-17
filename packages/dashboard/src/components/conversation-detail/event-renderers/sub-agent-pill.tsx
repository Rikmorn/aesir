import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SubAgentPillProps {
  agentDefinitionId: string;
}

// ─── Color Palette ──────────────────────────────────────────────────────────

export const AGENT_PILL_COLORS = [
  {
    bg: "bg-violet-500/10",
    text: "text-violet-400",
    border: "border-violet-500/20",
  },
  {
    bg: "bg-teal-500/10",
    text: "text-teal-400",
    border: "border-teal-500/20",
  },
  {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
  },
  {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/20",
  },
  { bg: "bg-sky-500/10", text: "text-sky-400", border: "border-sky-500/20" },
  {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
  },
] as const;

// ─── Hash Function ──────────────────────────────────────────────────────────

/**
 * Deterministic hash for agent definition IDs.
 * Same agentDefinitionId always produces the same color index.
 */
export function hashAgentId(id: string): number {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % AGENT_PILL_COLORS.length;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SubAgentPill({ agentDefinitionId }: SubAgentPillProps) {
  const color =
    AGENT_PILL_COLORS[hashAgentId(agentDefinitionId)] ?? AGENT_PILL_COLORS[0];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium leading-none",
        color.bg,
        color.text,
        color.border,
      )}
    >
      {agentDefinitionId}
    </span>
  );
}
