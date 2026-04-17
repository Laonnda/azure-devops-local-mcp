/**
 * Truncates a string to maxChars, appending an indicator if truncated.
 */
export function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + `… [truncated, ${value.length} chars total]`;
}
