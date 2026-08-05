import { LocatorRecord } from '../../entities';
import { StepAction } from '../../common/enums';
import { ElementMatcherService, MatchableElement } from './element-matcher.service';
import { AutomationTestStep } from './locator-resolution.types';
import { planTestSteps } from './test-step-planner';

/**
 * Matching a test step to the scanned element it means (FR-UIS-025 §3).
 *
 * These are the cases that decide whether a generated test drives the right
 * control: naming, role compatibility, the page and frame the element lives
 * on, the section a step scopes its target to, and — most importantly — what
 * happens when two elements look equally plausible.
 */

const matcher = new ElementMatcherService();

function element(overrides: Partial<MatchableElement> = {}): MatchableElement {
  return {
    locatorId: overrides.locatorId ?? 'locator-1',
    scannedElementId: 'element-1',
    elementKey: overrides.elementKey ?? 'key-1',
    elementName: '',
    accessibleName: '',
    associatedLabel: '',
    placeholder: '',
    visibleText: '',
    nameAttribute: '',
    role: 'button',
    inputType: '',
    tagName: 'button',
    pageName: '',
    pageUrlPattern: '',
    pageState: '',
    frameKey: '',
    scopes: [],
    nearestHeading: '',
    sensitive: false,
    approved: true,
    confidenceScore: 0.95,
    ...overrides,
  };
}

function step(
  description: string,
  overrides: Partial<AutomationTestStep> = {},
): AutomationTestStep {
  const [planned] = planTestSteps({ id: 'tc-1', steps: [description] });
  return { ...planned!, ...overrides };
}

describe('ElementMatcherService', () => {
  it('matches "Enter a valid email address" to the email textbox', () => {
    const email = element({
      locatorId: 'locator-email',
      elementKey: 'email',
      elementName: 'Email address',
      accessibleName: 'Email address',
      associatedLabel: 'Email address',
      role: 'textbox',
      inputType: 'email',
      pageName: 'Login',
    });
    const submit = element({
      locatorId: 'locator-login',
      elementKey: 'login',
      elementName: 'Login',
      accessibleName: 'Login',
      role: 'button',
      pageName: 'Login',
    });

    const outcome = matcher.match(step('Enter a valid email address'), [email, submit]);

    expect(outcome.best?.element.locatorId).toBe('locator-email');
    expect(outcome.best!.confidence).toBeGreaterThan(0.5);
    expect(outcome.ambiguous).toBe(false);
  });

  it('never matches a fill step to a button', () => {
    const button = element({ elementName: 'Email', accessibleName: 'Email', role: 'button' });
    const outcome = matcher.match(step('Enter the email address'), [button]);
    expect(outcome.best).toBeNull();
  });

  it('resolves "Click Save in the Profile section" by its container, not by position', () => {
    const profileSave = element({
      locatorId: 'locator-save-profile',
      elementKey: 'save-profile',
      elementName: 'Profile Save button',
      accessibleName: 'Save',
      role: 'button',
      pageName: 'Account Settings',
      scopes: [{ role: 'region', name: 'Profile' }],
    });
    const billingSave = element({
      locatorId: 'locator-save-billing',
      elementKey: 'save-billing',
      elementName: 'Billing Save button',
      accessibleName: 'Save',
      role: 'button',
      pageName: 'Account Settings',
      scopes: [{ role: 'region', name: 'Billing' }],
    });

    const outcome = matcher.match(
      step('Click Save in the Profile section'),
      [billingSave, profileSave],
    );

    expect(outcome.best?.element.locatorId).toBe('locator-save-profile');
    expect(outcome.ambiguous).toBe(false);
  });

  it('reports two indistinguishable elements as ambiguous rather than guessing', () => {
    const first = element({
      locatorId: 'locator-a',
      elementKey: 'save-a',
      elementName: 'Save',
      accessibleName: 'Save',
    });
    const second = element({
      locatorId: 'locator-b',
      elementKey: 'save-b',
      elementName: 'Save',
      accessibleName: 'Save',
    });

    const outcome = matcher.match(step('Click Save'), [first, second]);

    expect(outcome.ambiguous).toBe(true);
  });

  it('excludes an element that belongs to another page', () => {
    const other = element({
      elementName: 'Save',
      accessibleName: 'Save',
      pageName: 'Billing',
    });
    const outcome = matcher.match(
      step('Click Save', { pageName: 'Account Settings' }),
      [other],
    );
    expect(outcome.best).toBeNull();
  });

  it('excludes an element in a different frame', () => {
    const inFrame = element({
      elementName: 'Pay now',
      accessibleName: 'Pay now',
      frameKey: 'iframe[title="Payment"]',
    });
    const mainDocument = matcher.match(
      step('Click Pay now', { frameKey: '' }),
      [inFrame],
    );
    expect(mainDocument.best).toBeNull();

    const sameFrame = matcher.match(
      step('Click Pay now', { frameKey: 'iframe[title="Payment"]' }),
      [inFrame],
    );
    expect(sameFrame.best?.element.frameKey).toBe('iframe[title="Payment"]');
  });

  it('excludes an element captured in a different page state', () => {
    const inDialog = element({
      elementName: 'Confirm',
      accessibleName: 'Confirm',
      pageState: 'dialog:Delete account',
    });
    const outcome = matcher.match(
      step('Click Confirm', { pageState: '' }),
      [inDialog],
    );
    expect(outcome.best).toBeNull();
  });

  it('prefers a password field for a password step', () => {
    const password = element({
      locatorId: 'locator-password',
      elementKey: 'password',
      elementName: 'Password',
      associatedLabel: 'Password',
      role: 'textbox',
      inputType: 'password',
    });
    const hint = element({
      locatorId: 'locator-hint',
      elementKey: 'hint',
      elementName: 'Password hint',
      associatedLabel: 'Password hint',
      role: 'textbox',
      inputType: 'text',
    });

    const outcome = matcher.match(step('Enter a valid password'), [hint, password]);

    expect(outcome.best?.element.locatorId).toBe('locator-password');
  });

  it('matches a role-less password input, which has no implicit ARIA role', () => {
    // `input[type=password]` carries no role at all. Excluding role-less
    // elements would make every password step permanently unresolvable —
    // found the hard way against a real scan.
    const password = element({
      locatorId: 'locator-password',
      elementKey: 'password',
      elementName: 'Password',
      associatedLabel: 'Password',
      role: '',
      tagName: 'input',
      inputType: 'password',
    });
    const outcome = matcher.match(step('Enter a valid password'), [password]);
    expect(outcome.best?.element.locatorId).toBe('locator-password');
    expect(outcome.best!.confidence).toBeGreaterThan(0.8);
  });

  it('does not treat the page-level landmark as a section a step can name', () => {
    // A `main` landmark's accessible name is computed from its contents, so on
    // a real page it "contains" every word on screen. Counting it as a
    // container made every element live in every section.
    const pageText =
      'Account Sign in Profile Billing Edit user Team members Notifications';
    const profileSave = element({
      locatorId: 'locator-save-profile',
      elementKey: 'save-profile',
      elementName: 'Save',
      accessibleName: 'Save',
      scopes: [
        { role: 'region', name: 'Profile' },
        { role: 'main', name: pageText },
      ],
    });
    const billingSave = element({
      locatorId: 'locator-save-billing',
      elementKey: 'save-billing',
      elementName: 'Save',
      accessibleName: 'Save',
      scopes: [
        { role: 'region', name: 'Billing' },
        { role: 'main', name: pageText },
      ],
    });

    const outcome = matcher.match(
      step('Click Save in the Profile section'),
      [billingSave, profileSave],
    );

    expect(outcome.best?.element.locatorId).toBe('locator-save-profile');
    expect(outcome.ambiguous).toBe(false);
  });

  it('reads the input type from the key the scanner actually writes', () => {
    const record = {
      id: 'locator-password',
      elementKey: 'password',
      elementName: 'Password',
      role: '',
      approved: true,
      confidenceScore: 0.98,
      locatorData: { strategy: 'label', value: 'Password' },
      elementSnapshot: {
        tagName: 'input',
        attributes: { inputType: 'password', name: 'password' },
        context: {},
      },
    } as unknown as LocatorRecord;
    expect(matcher.toMatchable(record).inputType).toBe('password');
  });

  it('flattens a locator record into everything the step can name', () => {
    const record = {
      id: 'locator-9',
      scannedElementId: 'element-9',
      elementKey: 'key-9',
      elementName: 'Email address',
      pageName: 'Login',
      pageUrlPattern: 'https://app.example.com/login',
      pageState: '',
      frameKey: '',
      role: 'textbox',
      approved: true,
      confidenceScore: 0.98,
      locatorData: { strategy: 'label', value: 'Email address' },
      elementSnapshot: {
        tagName: 'input',
        role: 'textbox',
        accessibleName: 'Email address',
        visibleText: '',
        attributes: { type: 'email', placeholder: 'you@example.com', name: 'email' },
        context: {
          associatedLabel: 'Email address',
          nearestHeading: 'Sign in',
          scopes: [{ role: 'form', name: 'Sign in' }],
        },
      },
    } as unknown as LocatorRecord;

    const flat = matcher.toMatchable(record);

    expect(flat.inputType).toBe('email');
    expect(flat.placeholder).toBe('you@example.com');
    expect(flat.associatedLabel).toBe('Email address');
    expect(flat.nearestHeading).toBe('Sign in');
    expect(flat.scopes).toEqual([{ role: 'form', name: 'Sign in', label: undefined }]);
  });

  it('derives the frame key from the locator data when the column is empty', () => {
    const record = {
      id: 'locator-frame',
      elementKey: 'pay',
      elementName: 'Pay now',
      role: 'button',
      approved: true,
      confidenceScore: 0.9,
      frameKey: '',
      locatorData: {
        strategy: 'role',
        role: 'button',
        name: 'Pay now',
        frame: { path: ['iframe[title="Payment"]'] },
      },
      elementSnapshot: {},
    } as unknown as LocatorRecord;

    expect(matcher.toMatchable(record).frameKey).toBe('iframe[title="Payment"]');
  });
});

describe('planTestSteps', () => {
  const cases: [string, StepAction][] = [
    ['Enter a valid email address', 'fill'],
    ['Click the Login button', 'click'],
    ['Check the Remember me checkbox', 'check'],
    ['Select "United Kingdom" from the Country dropdown', 'select'],
    ['Verify the welcome message is displayed', 'assert'],
    ['Navigate to the Login page', 'navigate'],
  ];
  it.each(cases)('classifies %s as %s', (text, action) => {
    expect(planTestSteps({ id: 'tc', steps: [text] })[0]!.action).toBe(action);
  });

  it('gives every step a stable, traceable id', () => {
    const steps = planTestSteps({ id: 'tc-7', steps: ['Click Login', 'Verify the banner'] });
    expect(steps.map((s) => s.testStepId)).toEqual(['tc-7:step-1', 'tc-7:step-2']);
  });

  it('carries a named page forward to the steps that follow it', () => {
    const steps = planTestSteps({
      id: 'tc-8',
      steps: ['Open the Login page', 'Enter the password', 'Click Login'],
    });
    expect(steps[1]!.pageName).toBe('Login');
    expect(steps[2]!.pageName).toBe('Login');
  });

  it('binds credential steps to fixtures, never to literals', () => {
    const steps = planTestSteps({ id: 'tc-9', steps: ['Enter a valid password'] });
    expect(steps[0]!.valueReference).toBe('credentials.password');
    expect(steps[0]!.testDataType).toBe('password');
  });

  it('prefers the test case’s own data over the credential fixture', () => {
    const steps = planTestSteps({
      id: 'tc-10',
      steps: ['Enter the promo code'],
      testData: { 'promo code': 'SAVE10' },
    });
    expect(steps[0]!.valueReference).toBe('test_data["promo code"]');
  });

  it('treats a URL assertion as needing no locator, but an on-screen one as needing one', () => {
    const [urlStep] = planTestSteps({
      id: 'tc-11',
      steps: ['Verify the user is redirected to /dashboard'],
    });
    const [messageStep] = planTestSteps({
      id: 'tc-12',
      steps: ['Verify the welcome message is displayed'],
    });
    expect(urlStep!.requiresLocator).toBe(false);
    expect(messageStep!.requiresLocator).toBe(true);
  });

  it('extracts the container a step scopes its target to', () => {
    const [scoped] = planTestSteps({
      id: 'tc-13',
      steps: ['Click Save in the Profile section'],
    });
    expect(scoped!.parentContext).toBe('Profile');
    expect(scoped!.targetPhrase).toBe('Save');
  });
});
