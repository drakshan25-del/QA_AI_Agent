import { ConfigService } from '@nestjs/config';
import { SecretBoxService } from './secret-box.service';

function configMock(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('SecretBoxService', () => {
  const service = new SecretBoxService(
    configMock({ secretsKey: 'unit-test-key', jwt: { accessSecret: 'jwt' } }),
  );

  it('round-trips a secret', () => {
    const sealed = service.seal('sk-super-secret');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('sk-super-secret');
    expect(service.open(sealed)).toBe('sk-super-secret');
  });

  it('uses a fresh IV per seal (identical plaintexts differ)', () => {
    expect(service.seal('same')).not.toEqual(service.seal('same'));
  });

  it('rejects tampered ciphertext', () => {
    const sealed = service.seal('payload');
    const parts = sealed.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
    expect(() => service.open(parts.join('.'))).toThrow();
  });

  it('rejects malformed input', () => {
    expect(() => service.open('not-a-sealed-secret')).toThrow('Malformed');
  });

  it('falls back to a JWT-derived key when SECRETS_ENCRYPTION_KEY is unset', () => {
    const fallback = new SecretBoxService(
      configMock({ secretsKey: '', jwt: { accessSecret: 'jwt-secret' } }),
    );
    expect(fallback.open(fallback.seal('x'))).toBe('x');
  });

  it('fails loudly when no key material exists', () => {
    const empty = new SecretBoxService(
      configMock({ secretsKey: '', jwt: { accessSecret: '' } }),
    );
    expect(() => empty.seal('x')).toThrow('No encryption key');
  });
});
