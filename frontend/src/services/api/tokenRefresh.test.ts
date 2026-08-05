/**
 * Proactive access-token refresh (FR-BE-002).
 *
 * Regression cover for the 401-per-token-lifetime behaviour: refresh used to be
 * triggered only by a 401 that had already failed, so every 15-minute access
 * token produced one rejected request and one rejected WebSocket handshake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.hoisted(() => vi.fn());

vi.mock('axios', () => {
  const instance = {
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    request: vi.fn(),
  };
  return {
    default: { create: vi.fn(() => instance), post: postMock },
    AxiosHeaders: { from: vi.fn((h: unknown) => h) },
  };
});

/** A JWT whose payload carries `exp`, seconds since epoch. */
function jwt(expiresInMs: number): string {
  const payload = { exp: Math.floor((Date.now() + expiresInMs) / 1000) };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${b64.replace(/=+$/, '')}.signature`;
}

const FIFTEEN_MIN = 15 * 60 * 1000;

describe('token expiry parsing', () => {
  it('reads the exp claim as epoch milliseconds', async () => {
    const { expiryOf } = await import('./tokenStore');
    const before = Date.now() + FIFTEEN_MIN;
    const parsed = expiryOf(jwt(FIFTEEN_MIN));
    expect(parsed).not.toBeNull();
    // exp has second precision, so allow a second of truncation.
    expect(Math.abs((parsed as number) - before)).toBeLessThanOrEqual(1000);
  });

  it.each([
    ['null', null],
    ['an opaque string', 'not-a-jwt'],
    ['a malformed payload', 'header.!!!not-base64!!!.sig'],
    ['a payload without exp', `header.${btoa('{"sub":"u1"}')}.sig`],
  ])('returns null for %s so the reactive path still applies', async (_label, token) => {
    const { expiryOf } = await import('./tokenStore');
    expect(expiryOf(token)).toBeNull();
  });
});

describe('proactive refresh scheduling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    postMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes at 80% of the token lifetime, before it expires', async () => {
    const { tokenStore } = await import('./tokenStore');
    await import('./client');

    postMock.mockResolvedValue({ data: { accessToken: jwt(FIFTEEN_MIN) } });
    tokenStore.set(jwt(FIFTEEN_MIN));

    // 80% of 15 min = 12 min. Nothing should fire before that.
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN * 0.8 - 1000);
    expect(postMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][0]).toContain('/auth/refresh');
  });

  it('re-arms itself after each refresh so the session never lapses', async () => {
    const { tokenStore } = await import('./tokenStore');
    await import('./client');

    postMock.mockImplementation(() =>
      Promise.resolve({ data: { accessToken: jwt(FIFTEEN_MIN) } }),
    );
    tokenStore.set(jwt(FIFTEEN_MIN));

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await vi.advanceTimersByTimeAsync(FIFTEEN_MIN * 0.8 + 1000);
      expect(postMock).toHaveBeenCalledTimes(cycle);
    }
  });

  it('cancels the timer on logout', async () => {
    const { tokenStore } = await import('./tokenStore');
    await import('./client');

    postMock.mockResolvedValue({ data: { accessToken: jwt(FIFTEEN_MIN) } });
    tokenStore.set(jwt(FIFTEEN_MIN));
    tokenStore.clear();

    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN * 2);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('does not schedule for a token whose expiry cannot be read', async () => {
    const { tokenStore } = await import('./tokenStore');
    await import('./client');

    tokenStore.set('opaque-token');
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN * 2);
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe('ensureFreshToken (WebSocket handshake path)', () => {
  beforeEach(() => {
    vi.resetModules();
    postMock.mockReset();
  });

  it('returns the current token without a refresh when it is still valid', async () => {
    const { tokenStore } = await import('./tokenStore');
    const { ensureFreshToken } = await import('./client');

    const token = jwt(FIFTEEN_MIN);
    tokenStore.set(token);

    await expect(ensureFreshToken()).resolves.toBe(token);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('refreshes rather than handing the gateway an expired token', async () => {
    const { tokenStore } = await import('./tokenStore');
    const { ensureFreshToken } = await import('./client');

    const fresh = jwt(FIFTEEN_MIN);
    postMock.mockResolvedValue({ data: { accessToken: fresh } });
    tokenStore.set(jwt(-1000)); // already expired

    await expect(ensureFreshToken()).resolves.toBe(fresh);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes a token inside the 30s near-expiry window', async () => {
    const { tokenStore } = await import('./tokenStore');
    const { ensureFreshToken } = await import('./client');

    const fresh = jwt(FIFTEEN_MIN);
    postMock.mockResolvedValue({ data: { accessToken: fresh } });
    tokenStore.set(jwt(10_000)); // valid, but expires in 10s

    await expect(ensureFreshToken()).resolves.toBe(fresh);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight refresh across concurrent callers', async () => {
    const { tokenStore } = await import('./tokenStore');
    const { ensureFreshToken } = await import('./client');

    postMock.mockResolvedValue({ data: { accessToken: jwt(FIFTEEN_MIN) } });
    tokenStore.set(jwt(-1000));

    await Promise.all([ensureFreshToken(), ensureFreshToken(), ensureFreshToken()]);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('resolves null when the refresh cookie is gone, so the socket stays down', async () => {
    const { tokenStore } = await import('./tokenStore');
    const { ensureFreshToken } = await import('./client');

    postMock.mockRejectedValue(new Error('401'));
    tokenStore.set(jwt(-1000));

    await expect(ensureFreshToken()).resolves.toBeNull();
    expect(tokenStore.get()).toBeNull();
  });
});
