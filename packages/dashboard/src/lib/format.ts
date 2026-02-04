/**
 * Formatting Utilities
 *
 * Human-readable formatters for duration, token count, relative time, and time ranges.
 * Used across all dashboard views for consistent display.
 */

/**
 * Format the duration between two dates as a human-readable string.
 *
 * @returns "<1s", "Xs", "Xm Xs", or "Xh Xm"
 */
export function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format a token count as a human-readable string.
 *
 * @returns "0", raw number if <1000, "X.Xk" if <1M, "X.XXM" otherwise
 */
export function formatTokenCount(tokens: number): string {
  if (tokens === 0) return "0";
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/**
 * Format a date as a human-readable relative time string.
 *
 * @returns "-" for null, "just now" for <60s, "Xm ago", "Xh ago", "Xd ago"
 */
export function formatRelativeTime(date: Date | null): string {
  if (!date) return "-";
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Map a time range string to a Date object.
 *
 * @param range - "1h", "24h", "7d", or any string (defaults to 24h)
 * @returns Date representing the start of the time range
 */
export function getTimeRangeDate(range: string): Date {
  const now = new Date();
  switch (range) {
    case "1h":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
}
