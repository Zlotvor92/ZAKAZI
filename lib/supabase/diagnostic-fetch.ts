/** Only transport metadata is retained: never headers, query strings or bodies. */
function endpoint(input: RequestInfo | URL): string {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/i);
    return rpc ? `/rest/v1/rpc/${rpc[1]}` : url.pathname.startsWith('/auth/v1/') ? '/auth/v1/[operation]' : '/[operation]';
  } catch {
    return '[unknown]';
  }
}

function transportCauses(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  function visit(value: unknown, depth: number) {
    if (depth > 4 || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    // Codes such as UND_ERR_CONNECT_TIMEOUT / ECONNRESET are more useful than
    // arbitrary exception text, which can contain credentials or client data.
    for (const key of ['name', 'code', 'syscall'] as const) {
      const field = record[key];
      if (typeof field === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(field)) parts.push(`${key}=${field}`);
      if (typeof field === 'number' && Number.isFinite(field)) parts.push(`${key}=${field}`);
    }
    visit(record.cause, depth + 1);
    if (value instanceof AggregateError) for (const child of value.errors.slice(0, 5)) visit(child, depth + 1);
  }
  visit(error, 0);
  return parts.join(' ');
}

export function withFetchDiagnostics(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const started = Date.now();
    try {
      return await inner(input, init);
    } catch (cause) {
      const rawMethod = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const method = /^[A-Z]{1,12}$/i.test(rawMethod) ? rawMethod.toUpperCase() : '[unknown]';
      // Supabase converts fetch exceptions into PostgREST errors and retains
      // their message; put the safe root cause there before it is lost.
      throw new Error(`fetch failed [method=${method} endpoint=${endpoint(input)} duration_ms=${Math.max(0, Date.now() - started)} ${transportCauses(cause)}]`);
    }
  };
}
