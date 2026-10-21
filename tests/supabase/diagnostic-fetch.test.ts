import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { withFetchDiagnostics } from '@/lib/supabase/diagnostic-fetch';

describe('fetch diagnostics', () => {
  it('retains nested network codes without leaking request or exception secrets', async () => {
    const inner = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('secret token and phone', {
      cause: new AggregateError([Object.assign(new Error('private address'), { code: 'ETIMEDOUT', syscall: 'connect' })]),
    }));
    const run = withFetchDiagnostics(inner);
    const error = await run('https://private:password@example.com/rest/v1/rpc/dashboard_week?token=secret', {
      method: 'POST', headers: { Authorization: 'Bearer secret' }, body: 'private client data',
    }).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('endpoint=/rest/v1/rpc/dashboard_week');
    expect(message).toContain('code=ETIMEDOUT');
    expect(message).toContain('syscall=connect');
    expect(message).toContain('duration_ms=');
    expect(message).not.toMatch(/secret|private|password|example.com|Authorization/);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('survives Supabase conversion into an RPC error', async () => {
    const client = createClient('https://example.com', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: withFetchDiagnostics(vi.fn<typeof fetch>().mockRejectedValue(
        new TypeError('fetch failed', { cause: Object.assign(new Error('connection timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) }),
      )) },
    });
    const { error } = await client.rpc('dashboard_week', { p_date: '2026-10-23' });
    expect(error?.message).toContain('UND_ERR_CONNECT_TIMEOUT');
    expect(error?.message).toContain('/rest/v1/rpc/dashboard_week');
  });

  it('passes responses through without consuming or changing them', async () => {
    const response = new Response('original error', { status: 503 });
    const run = withFetchDiagnostics(vi.fn<typeof fetch>().mockResolvedValue(response));
    expect(await run('https://example.com/rest/v1/rpc/dashboard_week')).toBe(response);
    expect(await response.text()).toBe('original error');
  });

  it('handles cyclic causes and hides arbitrary paths', async () => {
    const cause = Object.assign(new Error('secret'), { code: 'ECONNRESET' });
    cause.cause = cause;
    const run = withFetchDiagnostics(vi.fn<typeof fetch>().mockRejectedValue(cause));
    await expect(run(new Request('https://example.com/storage/v1/private-client'))).rejects.toThrow('endpoint=/[operation]');
  });
});
