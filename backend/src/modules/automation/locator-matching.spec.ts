import {
  namesAreEquivalent,
  normaliseName,
} from './element-matcher.service';
import { normaliseResolutionStatus } from '../../common/enums';

/**
 * Matching a test step's wording to an approved locator (FR-UIS-025 §3).
 *
 * A test case is written by a person describing intent ("the email field");
 * a scan records what the application calls the control ("Username"). Treating
 * those as unrelated was the root cause of approved locators being reported as
 * missing, which then blocked generation and execution.
 */
describe('locator name matching', () => {
  describe('normalisation', () => {
    it('ignores capitalisation', () => {
      expect(normaliseName('Email Address')).toBe(normaliseName('email address'));
      expect(normaliseName('LOGIN')).toBe('login');
    });

    it('ignores surrounding and repeated whitespace', () => {
      expect(normaliseName('  Email   Address  ')).toBe('email address');
    });

    it('treats hyphens and underscores as spaces', () => {
      expect(normaliseName('email-address')).toBe('email address');
      expect(normaliseName('email_address')).toBe('email address');
      expect(normaliseName('Email_Address')).toBe(normaliseName('email-address'));
    });

    it('drops punctuation that carries no meaning', () => {
      expect(normaliseName('Email Address:')).toBe('email address');
      expect(normaliseName('"Login"')).toBe('login');
    });

    it('survives an empty or missing value', () => {
      expect(normaliseName('')).toBe('');
      expect(normaliseName(undefined as unknown as string)).toBe('');
    });
  });

  describe('semantic equivalence', () => {
    it.each([
      ['email', 'username'],
      ['Email Address', 'Username'],
      ['email address', 'user name'],
      ['login email', 'username'],
      ['e-mail', 'email'],
      ['user_id', 'username'],
    ])('treats "%s" and "%s" as the same control', (step, element) => {
      expect(namesAreEquivalent(step, element)).toBe(true);
    });

    it.each([
      ['Login', 'Submit'],
      ['Sign in', 'Login'],
      ['log in', 'submit'],
      ['Continue', 'Submit'],
    ])('treats the "%s" action and the "%s" control as the same', (step, element) => {
      expect(namesAreEquivalent(step, element)).toBe(true);
    });

    it('matches password wording', () => {
      expect(namesAreEquivalent('Password', 'passcode')).toBe(true);
      expect(namesAreEquivalent('login password', 'password')).toBe(true);
    });

    it('does not conflate different controls', () => {
      expect(namesAreEquivalent('Username', 'Password')).toBe(false);
      expect(namesAreEquivalent('Login', 'Logout')).toBe(false);
      expect(namesAreEquivalent('First Name', 'Last Name')).toBe(false);
      expect(namesAreEquivalent('Search', 'Submit')).toBe(false);
    });

    it('never matches on an empty name', () => {
      expect(namesAreEquivalent('', 'Username')).toBe(false);
      expect(namesAreEquivalent('Username', '')).toBe(false);
    });

    it('is symmetric', () => {
      expect(namesAreEquivalent('email', 'username')).toBe(
        namesAreEquivalent('username', 'email'),
      );
    });
  });
});

/**
 * Historical data must not resurrect the removed workflow (§6).
 */
describe('legacy resolution statuses', () => {
  it('maps the removed review status onto a diagnostic', () => {
    expect(normaliseResolutionStatus('LOCATOR_REVIEW_REQUIRED')).toBe(
      'NO_APPROVED_MATCH',
    );
  });

  it('leaves current statuses untouched', () => {
    expect(normaliseResolutionStatus('RESOLVED')).toBe('RESOLVED');
    expect(normaliseResolutionStatus('PARTIALLY_RESOLVED')).toBe('PARTIALLY_RESOLVED');
    expect(normaliseResolutionStatus('NO_APPROVED_MATCH')).toBe('NO_APPROVED_MATCH');
  });

  it('treats anything unrecognised as resolved rather than as a block', () => {
    expect(normaliseResolutionStatus(undefined)).toBe('RESOLVED');
    expect(normaliseResolutionStatus(null)).toBe('RESOLVED');
    expect(normaliseResolutionStatus('something-else')).toBe('RESOLVED');
  });

  it('never returns a review status', () => {
    for (const input of [
      'LOCATOR_REVIEW_REQUIRED',
      'RESOLVED',
      'PARTIALLY_RESOLVED',
      undefined,
    ]) {
      expect(normaliseResolutionStatus(input)).not.toMatch(/REVIEW/);
    }
  });
});
