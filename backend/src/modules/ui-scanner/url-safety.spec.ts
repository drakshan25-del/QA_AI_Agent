import { assertUrlIsSafe, isPrivateAddress, parseAllowedHosts, toPagePattern } from './url-safety';
import { ValidationFailedException } from '../../common/errors';

/**
 * SSRF protection (FR-UIS-023, SEC-003). These rules decide whether the
 * platform will open a URL a user typed, from inside the trusted network, so
 * each one is pinned here.
 */
describe('UI scanner URL safety', () => {
  describe('protocol', () => {
    it.each(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com'])(
      'refuses %s',
      async (url) => {
        await expect(assertUrlIsSafe(url)).rejects.toBeInstanceOf(
          ValidationFailedException,
        );
      },
    );

    it('explains what a usable URL looks like', async () => {
      await expect(assertUrlIsSafe('example.com')).rejects.toThrow(
        /absolute URL/i,
      );
    });

    it('requires a URL at all', async () => {
      await expect(assertUrlIsSafe('   ')).rejects.toThrow(/required/i);
    });
  });

  describe('address ranges', () => {
    it.each([
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.0.5',
      '169.254.169.254',
      '100.64.1.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])('treats %s as internal', (address) => {
      expect(isPrivateAddress(address)).toBe(true);
    });

    it.each(['8.8.8.8', '203.0.113.10', '2606:4700:4700::1111'])(
      'treats %s as public',
      (address) => {
        expect(isPrivateAddress(address)).toBe(false);
      },
    );

    it('treats an unparseable address as unsafe', () => {
      expect(isPrivateAddress('not-an-address')).toBe(true);
    });
  });

  describe('resolution', () => {
    it('refuses a loopback literal by default', async () => {
      await expect(assertUrlIsSafe('http://127.0.0.1:8000/app')).rejects.toThrow(
        /internal address/i,
      );
    });

    it('allows a loopback literal when the host is on the allow-list', async () => {
      const safe = await assertUrlIsSafe('http://127.0.0.1:8000/app', {
        allowedHosts: ['127.0.0.1'],
      });
      expect(safe.hostname).toBe('127.0.0.1');
    });

    it('allows loopback when private networking is explicitly enabled', async () => {
      const safe = await assertUrlIsSafe('http://127.0.0.1:8000/app', {
        allowPrivateNetwork: true,
      });
      expect(safe.addresses).toEqual(['127.0.0.1']);
    });

    it('refuses the cloud metadata address even with private networking on', async () => {
      await expect(
        assertUrlIsSafe('http://169.254.169.254/latest/meta-data/', {
          allowPrivateNetwork: true,
        }),
      ).rejects.toThrow(/metadata/i);
    });

    it('refuses the cloud metadata hostname', async () => {
      await expect(
        assertUrlIsSafe('http://metadata.google.internal/'),
      ).rejects.toThrow(/metadata/i);
    });

    it('reports an unresolvable host clearly', async () => {
      await expect(
        assertUrlIsSafe('http://this-host-does-not-exist.invalid/'),
      ).rejects.toThrow(/could not be resolved/i);
    });
  });

  describe('allow-list parsing', () => {
    it('normalises wildcards and whitespace', () => {
      expect(parseAllowedHosts(' *.internal.test , localhost,, 127.0.0.1 ')).toEqual([
        'internal.test',
        'localhost',
        '127.0.0.1',
      ]);
    });

    it('handles an unset value', () => {
      expect(parseAllowedHosts(undefined)).toEqual([]);
    });
  });

  describe('page patterns', () => {
    it('drops the query string and fragment so a locator keys on the page', () => {
      expect(toPagePattern('https://example.com/users/list?page=3#top')).toBe(
        'https://example.com/users/list',
      );
    });

    it('keeps a bare origin usable', () => {
      expect(toPagePattern('https://example.com/')).toBe('https://example.com');
    });
  });
});
