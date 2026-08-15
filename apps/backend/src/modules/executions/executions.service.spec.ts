import { allowedDomainsWithTargets } from './executions.service';

describe('allowedDomainsWithTargets (SEC-003 target-host merge)', () => {
  it('keeps the allow-list unchanged when targets are already listed', () => {
    expect(
      allowedDomainsWithTargets(
        'localhost,127.0.0.1',
        'http://localhost:8001',
        'http://localhost:3000/api',
      ),
    ).toBe('localhost,127.0.0.1');
  });

  it('appends a configured API host missing from the allow-list', () => {
    expect(
      allowedDomainsWithTargets(
        'localhost,127.0.0.1',
        'http://localhost:8001',
        'http://api.internal:3000/api/v1',
      ),
    ).toBe('localhost,127.0.0.1,api.internal');
  });

  it('deduplicates case-insensitively and ignores empty/malformed URLs', () => {
    expect(
      allowedDomainsWithTargets(
        'Example.com',
        'https://example.com/app',
        '',
        'not a url',
        undefined,
      ),
    ).toBe('Example.com');
  });
});
