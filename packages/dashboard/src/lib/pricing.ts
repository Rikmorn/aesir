/**
 * Model Pricing Utilities
 *
 * Client-side cost estimation for Anthropic model usage.
 * Prices are per million tokens (input/output) in USD.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

// ─── Pricing Table ──────────────────────────────────────────────────────────

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Sonnet 4
  "claude-sonnet-4-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4": { inputPerMTok: 3, outputPerMTok: 15 },
  // Haiku 4.5
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4.5": { inputPerMTok: 1, outputPerMTok: 5 },
  // Opus 4
  "claude-opus-4": { inputPerMTok: 5, outputPerMTok: 25 },
};

/** Default pricing uses Sonnet rates (most common model in Aesir). */
const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Estimate the cost of a single LLM call based on token counts and model.
 *
 * Falls back to Sonnet pricing when the model is unknown or not provided.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model?: string,
): number {
  const pricing =
    model !== undefined
      ? (MODEL_PRICING[model] ?? DEFAULT_PRICING)
      : DEFAULT_PRICING;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}

/**
 * Format a cost value as a USD string.
 *
 * Returns "$0.00" for zero, "<$0.01" for sub-cent amounts, "$X.XX" otherwise.
 * The caller adds the "~" prefix when displaying in the UI to keep this utility pure.
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}
