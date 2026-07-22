/**
 * Coerce ANY error-ish value into readable text so it can be rendered in JSX
 * without crashing React ("Objects are not valid as a React child").
 *
 * Error values crossing an HTTP boundary are typed as `string` but can arrive as
 * objects at runtime — our own `{ code, message }` shape, a FastAPI validation
 * item `{ loc, msg, type }`, an array of those (422), or a nested `{ detail }`.
 * This never throws and never returns a non-string.
 */
export function errorText(
  value: unknown,
  fallback = 'Something went wrong'
): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);

  if (Array.isArray(value)) {
    const parts = value.map((v) => errorText(v, '')).filter(Boolean);
    return parts.length ? parts.join('; ') : fallback;
  }

  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    // Prefer a human-readable field, then a machine code, before giving up.
    for (const key of ['message', 'msg', 'reason', 'error', 'detail', 'code']) {
      const inner = o[key];
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
      if (inner && typeof inner === 'object') return errorText(inner, fallback);
    }
    try {
      const json = JSON.stringify(value);
      if (json && json !== '{}') return json;
    } catch {
      /* fall through */
    }
    return fallback;
  }

  return fallback;
}
