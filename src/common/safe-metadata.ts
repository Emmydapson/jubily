const SENSITIVE_KEY = /(secret|token|password|authorization|cookie|api[_-]?key|client[_-]?secret|refresh|access)/i;

export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MaxDepth]';
  if (value == null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeMetadata(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeMetadata(item, depth + 1);
  }
  return out;
}

export function safeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error');
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(access_token|refresh_token|client_secret|api_key|password)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/\b(sk|pk|rk|whsec|re_|AIza)[A-Za-z0-9_./+=-]{8,}\b/g, '[REDACTED]')
    .slice(0, 500);
}
