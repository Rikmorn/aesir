"use client";

/**
 * Edge Tooltip
 *
 * Simple presentational tooltip for delegation edges.
 * Shows signal type, timestamp, and optional payload preview.
 * Positioned via absolute transform from parent SVG foreignObject or overlay div.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface EdgeTooltipProps {
  signalType?: string;
  timestamp?: string;
  payloadPreview?: string;
  visible: boolean;
  x: number;
  y: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EdgeTooltip({
  signalType,
  timestamp,
  payloadPreview,
  visible,
  x,
  y,
}: EdgeTooltipProps) {
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute z-50 rounded border bg-popover p-2 text-xs shadow-md"
      style={{
        transform: `translate(${x}px, ${y}px)`,
        left: 0,
        top: 0,
      }}
    >
      {signalType && (
        <div className="font-semibold text-popover-foreground">
          {signalType}
        </div>
      )}
      {timestamp && <div className="text-muted-foreground">{timestamp}</div>}
      {payloadPreview && (
        <div className="mt-1 max-w-48 truncate text-muted-foreground">
          {payloadPreview}
        </div>
      )}
    </div>
  );
}
