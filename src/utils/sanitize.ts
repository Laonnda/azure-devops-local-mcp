/**
 * Credential sanitization utilities.
 * Strips PATs, Bearer tokens, and connection strings from any output.
 */

const PATTERNS: RegExp[] = [
  // Base64-encoded PAT (Basic auth header value)
  /Basic\s+[A-Za-z0-9+/=]{20,}/g,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  // Raw PAT-like strings (Azure DevOps PATs are typically 52+ chars)
  /[a-z0-9]{52,}/gi,
  // Connection strings with passwords
  /Password=[^;]+/gi,
  // Azure DevOps PAT patterns in URLs
  /https?:\/\/[^:]+:[^@]+@/g,
];

const REDACTED = "[REDACTED]";

export function sanitizeString(input: string): string {
  let result = input;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return sanitizeString(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as T;
  }

  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("token") ||
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("authorization") ||
        lowerKey === "pat"
      ) {
        sanitized[key] = REDACTED;
      } else {
        sanitized[key] = sanitizeObject(value);
      }
    }
    return sanitized as T;
  }

  return obj;
}
