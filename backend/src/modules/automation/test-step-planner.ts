import { LOCATOR_BEARING_ACTIONS, StepAction } from '../../common/enums';
import { AutomationTestStep } from './locator-resolution.types';

/**
 * Turn an approved test case into addressable, resolvable steps
 * (FR-UIS-025 §3 "read each test step").
 *
 * A stored test case is prose: `steps` is a list of sentences a human wrote.
 * Locator resolution needs each sentence to have a stable identity, a known
 * interaction, and whatever page, container and element hints the sentence
 * carries — so this module extracts them deterministically, before any model
 * is involved. Everything here is pure text analysis: no model, no browser, no
 * database.
 *
 * The extraction is deliberately conservative. A hint it is not sure about is
 * simply not emitted: the matcher treats a missing hint as "unconstrained",
 * whereas a wrong hint would send it to the wrong page.
 */

/** Verbs that identify the interaction, longest phrase first. */
const ACTION_PATTERNS: [RegExp, StepAction][] = [
  [/\b(navigate|go|open|browse|visit|load)\b.*\b(to|the)?\b.*\b(page|url|site|application|app)\b/i, 'navigate'],
  [/\b(navigate to|go to|open|visit)\b/i, 'navigate'],
  [/\b(upload|attach|choose file|select file)\b/i, 'upload'],
  [/\b(check|tick|untick|uncheck|toggle)\b/i, 'check'],
  [/\b(select|choose|pick)\b.*\b(from|in)\b.*\b(dropdown|list|combo|menu|option)\b/i, 'select'],
  [/\b(select|choose)\b.*\b(option|dropdown)\b/i, 'select'],
  [/\b(press|hit)\b/i, 'press'],
  [/\b(hover|mouse over)\b/i, 'hover'],
  [/\b(enter|type|fill|input|provide|supply|key in|populate)\b/i, 'fill'],
  [/\b(click|tap|submit|press the .* button)\b/i, 'click'],
  [/\b(verify|validate|confirm|assert|ensure|check that|should see|should be|is displayed|is shown|observe)\b/i, 'assert'],
  [/\b(wait)\b/i, 'wait'],
];

/** Containers a step can name, e.g. "in the Profile section". */
const CONTAINER_RE =
  /\b(?:in|inside|within|on|under|from)\s+(?:the\s+)?["'“]?([A-Za-z0-9][\w &/-]{1,40}?)["'”]?\s+(section|panel|dialog|modal|form|card|region|group|table|row|sidebar|header|footer|menu|tab|toolbar)\b/i;

/**
 * A page a step names — "on the Account Settings page", but also the way most
 * test cases actually open one: "Open the Login page", "Navigate to Checkout".
 */
const PAGE_RE =
  /\b(?:on|from|to|in|open|opens|visit|load|access|launch)\s+(?:the\s+)?["'“]?([A-Za-z0-9][\w &/-]{1,40}?)["'”]?\s+(page|screen|view)\b/i;

/** A quoted element name — the strongest signal a step can carry. */
const QUOTED_RE = /["'“”']([^"'“”']{1,60})["'“”']/;

/**
 * The element phrase in an unquoted step: the words between the verb and a
 * trailing noun such as button/field/link, e.g. "Click the Save button".
 */
const NOUN_PHRASE_RE =
  /\b(?:click|tap|press|select|choose|check|tick|hover over|enter\s+\w+\s+(?:in|into)|fill|type\s+\w+\s+(?:in|into)|upload)\s+(?:on\s+)?(?:the\s+)?([\w][\w &/'-]{0,50}?)\s*(button|link|field|input|box|checkbox|radio|dropdown|menu|tab|icon|option|toggle|switch)\b/i;

/**
 * A trailing phrase after the verb when no noun anchors it: "Click Login".
 *
 * Split in two because the verb is matched case-insensitively while the target
 * must stay case-*sensitive*: it is the run of Capitalised Words that names the
 * control, and an `i` flag would swallow the rest of the sentence
 * ("Click Save in the Profile section" → "Save", not "Save in the Profile…").
 */
const TRAILING_VERB_RE = /\b(?:click|tap|press|select|choose|open|hover over)\b/i;
const CAPITALISED_RUN_RE = /^\s*(?:on\s+)?(?:the\s+)?([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)*)/;

/** Data kinds a step can supply, mapped to the fixture that provides them. */
const DATA_HINTS: { re: RegExp; type: string; valueReference?: string }[] = [
  { re: /\bpassword\b/i, type: 'password', valueReference: 'credentials.password' },
  {
    re: /\b(username|user name|user id|login id|email address|e-mail address|email)\b/i,
    type: 'username',
    valueReference: 'credentials.username',
  },
  { re: /\b(date|dob|birth)\b/i, type: 'date' },
  { re: /\b(phone|mobile|telephone)\b/i, type: 'phone' },
  { re: /\b(amount|quantity|number)\b/i, type: 'number' },
  { re: /\b(search|query|keyword)\b/i, type: 'search' },
];

/**
 * Nouns that make an assertion element-bound.
 *
 * An assertion is only a locator-bearing step when it talks about something on
 * screen. "Verify the user is redirected to /dashboard" asserts a URL and needs
 * no locator; "Verify the welcome message is displayed" needs one. Treating
 * every expectation as locator-bearing would flood the review queue with steps
 * that were never about an element.
 */
const ASSERTION_TARGET_RE =
  /\b(message|banner|alert|error|heading|title|text|label|button|link|field|input|row|table|list|item|icon|badge|dialog|modal|toast|notification|tooltip|column|cell|checkbox|dropdown|menu|tab|element|section|panel|card)\b/i;

/** Words that carry no matching signal in a test step. */
const NOISE = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'in',
  'into',
  'on',
  'at',
  'of',
  'for',
  'with',
  'valid',
  'invalid',
  'correct',
  'incorrect',
  'user',
  'users',
  'then',
  'when',
  'should',
  'is',
  'be',
  'are',
  'that',
  'it',
  'its',
  'this',
  'their',
  'value',
  'values',
  'test',
  'data',
]);

/** Interaction the step performs, from its verb (§3 "test-step action"). */
export function classifyAction(text: string): StepAction {
  const trimmed = (text || '').trim();
  for (const [pattern, action] of ACTION_PATTERNS) {
    if (pattern.test(trimmed)) return action;
  }
  return 'assert';
}

/** The element name a step names, when it names one unambiguously. */
export function extractTargetPhrase(text: string): string {
  const quoted = QUOTED_RE.exec(text);
  if (quoted?.[1]) return quoted[1].trim();
  const noun = NOUN_PHRASE_RE.exec(text);
  if (noun?.[1]) return noun[1].trim();
  const verb = TRAILING_VERB_RE.exec(text);
  if (verb) {
    const run = CAPITALISED_RUN_RE.exec(text.slice(verb.index + verb[0].length));
    if (run?.[1]) return run[1].trim();
  }
  return '';
}

/** The container a step scopes its target to ("in the Profile section"). */
export function extractParentContext(text: string): string {
  const match = CONTAINER_RE.exec(text);
  return match?.[1] ? match[1].trim() : '';
}

/** The page a step names ("on the Account Settings page"). */
export function extractPageName(text: string): string {
  const match = PAGE_RE.exec(text);
  return match?.[1] ? match[1].trim() : '';
}

/** Whether a step drives a UI element and therefore needs a locator (§3). */
export function requiresLocator(action: StepAction, text: string): boolean {
  if (!text.trim()) return false;
  if (!LOCATOR_BEARING_ACTIONS.includes(action)) return false;
  if (action !== 'assert') return true;
  return ASSERTION_TARGET_RE.test(text) || Boolean(extractTargetPhrase(text));
}

/** Content words of a step, with the noise a test step is full of removed. */
export function stepTokens(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !NOISE.has(t));
}

/**
 * Which fixture value a `fill` step should use (FR-AUT-005 — never a literal).
 *
 * A test case's own `testData` wins when one of its keys is named in the step;
 * otherwise the credential fixture covers the username/password cases and
 * anything else is left to the generator with the data type as a hint.
 */
export function valueReferenceFor(
  text: string,
  testData: Record<string, string> | null | undefined,
): { valueReference?: string; testDataType?: string } {
  const tokens = new Set(stepTokens(text));
  for (const key of Object.keys(testData ?? {})) {
    const keyTokens = stepTokens(key);
    if (keyTokens.length && keyTokens.every((t) => tokens.has(t))) {
      return { valueReference: `test_data[${JSON.stringify(key)}]`, testDataType: key };
    }
  }
  for (const hint of DATA_HINTS) {
    if (hint.re.test(text)) {
      return { valueReference: hint.valueReference, testDataType: hint.type };
    }
  }
  return {};
}

/** The stable id of one step within its test case (§9 traceability). */
export function testStepId(testCaseId: string, sequence: number): string {
  return `${testCaseId}:step-${sequence}`;
}

export interface PlannableTestCase {
  id: string;
  caseKey?: string;
  steps?: string[] | null;
  testData?: Record<string, string> | null;
  preconditions?: string[] | null;
}

/**
 * Plan the resolvable steps of one test case.
 *
 * Expected results are deliberately not planned as steps: they become
 * assertions on elements the interaction steps already resolved, and turning
 * every expectation into its own locator lookup produces noise, not coverage.
 */
export function planTestSteps(testCase: PlannableTestCase): AutomationTestStep[] {
  const steps = testCase.steps ?? [];
  // A page named in one step applies to the steps that follow it, exactly as a
  // human reads the case: "Open the Login page" then "Enter the password".
  let currentPage = '';
  for (const pre of testCase.preconditions ?? []) {
    const named = extractPageName(String(pre));
    if (named) currentPage = named;
  }

  return steps.map((raw, index) => {
    const description = String(raw ?? '').trim();
    const sequence = index + 1;
    const action = classifyAction(description);
    const namedPage = extractPageName(description);
    if (namedPage) currentPage = namedPage;
    const { valueReference, testDataType } = valueReferenceFor(
      description,
      testCase.testData,
    );
    return {
      testStepId: testStepId(testCase.id, sequence),
      testCaseId: testCase.id,
      sequence,
      description,
      action,
      requiresLocator: requiresLocator(action, description),
      valueReference,
      testDataType,
      pageName: currentPage || undefined,
      parentContext: extractParentContext(description) || undefined,
      targetPhrase: extractTargetPhrase(description) || undefined,
    };
  });
}
