import { Injectable } from '@nestjs/common';
import { LocatorRecord } from '../../entities';
import { StepAction } from '../../common/enums';
import { LocatorData } from '../ui-scanner/ui-scanner.types';
import { AutomationTestStep } from './locator-resolution.types';
import { stepTokens } from './test-step-planner';

/**
 * Matching a test step to the scanned element it means (FR-UIS-025 §3).
 *
 * This is the deterministic half of locator resolution, and it runs before any
 * model is consulted. It compares what the step says against what the scanner
 * recorded — role, accessible name, label, placeholder, input type, visible
 * text, containing form/dialog/region/row, nearest heading, page and frame —
 * and returns a ranked list with a confidence per candidate.
 *
 * Two rules shape the design:
 *
 * 1. **Wrong is worse than nothing.** A step that cannot be pinned to one
 *    element returns an ambiguous verdict rather than a coin flip, because a
 *    test wired to the wrong control fails in a way nobody can diagnose.
 * 2. **Never disambiguate by position.** When several elements match equally,
 *    the answer is the containing section, dialog, row or form named in the
 *    step — never `.nth()` (§3).
 */

/** Roles each interaction can legitimately drive. */
const ACTION_ROLES: Record<StepAction, string[]> = {
  fill: ['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider'],
  click: [
    'button',
    'link',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'tab',
    'checkbox',
    'radio',
    'switch',
    'option',
    'treeitem',
    'gridcell',
    'cell',
  ],
  check: ['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'],
  select: ['combobox', 'listbox', 'option', 'menu'],
  press: ['textbox', 'searchbox', 'button', 'combobox'],
  hover: [],
  upload: ['button', 'textbox'],
  navigate: ['link'],
  assert: [],
  wait: [],
};

/** Input types a data hint implies, for `fill` steps. */
const DATA_TYPE_INPUTS: Record<string, string[]> = {
  username: ['email', 'text'],
  password: ['password'],
  date: ['date', 'datetime-local', 'month', 'week'],
  phone: ['tel'],
  number: ['number'],
  search: ['search', 'text'],
};

/** Words in a data hint that should also appear in the element's naming. */
const DATA_TYPE_WORDS: Record<string, string[]> = {
  username: ['username', 'user', 'email', 'login'],
  password: ['password', 'passcode'],
  date: ['date', 'birth', 'dob'],
  phone: ['phone', 'mobile', 'telephone'],
  number: ['amount', 'quantity', 'number', 'count'],
  search: ['search', 'query', 'keyword'],
};

/**
 * Score weights. Kept in one place so the ranking stays explainable, and
 * normalised per step rather than against a fixed maximum: a step that names
 * no container cannot earn the container points, so counting them in the
 * denominator would cap a perfect match at a mediocre confidence.
 */
const WEIGHTS = {
  exactPhrase: 55,
  startsWithPhrase: 34,
  containsPhrase: 22,
  tokenOverlap: 26,
  roleMatch: 18,
  inputTypeMatch: 14,
  dataWordMatch: 10,
  pageMatch: 16,
  parentContextMatch: 30,
  parentContextMissing: -18,
  headingMatch: 10,
  frameMatch: 8,
  approved: 12,
  confidence: 10,
  sensitivePenalty: -25,
} as const;

/** Confidence gap below which two candidates count as equally good (§18). */
export const AMBIGUITY_MARGIN = 0.06;

/**
 * Names compared for equivalence after normalisation (FR-UIS-025 §3).
 *
 * A test case is written by a person describing intent ("the email field"),
 * while a scan records what the application calls the control ("Username").
 * Both name the same box, and treating them as unrelated was the single
 * biggest source of steps the matcher could not bind — the wording differs,
 * the element does not.
 *
 * Each row is a set of interchangeable names. Membership is symmetric.
 */
const SEMANTIC_EQUIVALENTS: string[][] = [
  ['email', 'email address', 'e mail', 'username', 'user name', 'user id', 'userid',
   'login', 'login email', 'login id', 'username email', 'email username',
   'account', 'user'],
  ['password', 'passcode', 'pwd', 'pass word', 'login password'],
  ['submit', 'login', 'log in', 'sign in', 'signin', 'log on', 'logon', 'continue',
   'next', 'go', 'enter'],
  ['sign out', 'signout', 'log out', 'logout', 'exit'],
  ['search', 'find', 'query', 'lookup'],
  ['first name', 'given name', 'forename'],
  ['last name', 'surname', 'family name'],
  ['phone', 'telephone', 'mobile', 'phone number', 'contact number'],
  ['confirm password', 'repeat password', 'retype password', 'verify password'],
];

/** Fast lookup from a normalised name to the group it belongs to. */
const EQUIVALENCE_GROUPS: Map<string, number> = new Map(
  SEMANTIC_EQUIVALENTS.flatMap((group, index) =>
    group.map((name) => [name, index] as [string, number]),
  ),
);

/**
 * Canonical form for comparing a step's wording with an element's name.
 *
 * Case, surrounding whitespace, repeated spaces, hyphens, underscores and
 * trailing punctuation are all presentation. "Email_Address", "email-address"
 * and "  Email  Address " are one name, and the matcher must see them that way.
 */
export function normaliseName(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when two names mean the same control despite different wording. */
export function namesAreEquivalent(a: string, b: string): boolean {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftGroup = EQUIVALENCE_GROUPS.get(left);
  const rightGroup = EQUIVALENCE_GROUPS.get(right);
  return leftGroup !== undefined && leftGroup === rightGroup;
}

/** One scanned element as the matcher sees it, flattened from its record. */
export interface MatchableElement {
  locatorId: string;
  scannedElementId: string;
  elementKey: string;
  elementName: string;
  accessibleName: string;
  associatedLabel: string;
  placeholder: string;
  visibleText: string;
  nameAttribute: string;
  role: string;
  inputType: string;
  tagName: string;
  pageName: string;
  pageUrlPattern: string;
  pageState: string;
  frameKey: string;
  /** Named containers, nearest first: form, dialog, region, row, section. */
  scopes: { role: string; name: string; label?: string }[];
  nearestHeading: string;
  sensitive: boolean;
  approved: boolean;
  confidenceScore: number;
}

export interface ElementMatch {
  element: MatchableElement;
  /** 0..1 — how confident the matcher is that this is the step's target. */
  confidence: number;
  /** Raw signal contributions, kept for the review UI and for debugging. */
  rationale: Record<string, unknown>;
}

export interface MatchOutcome {
  best: ElementMatch | null;
  /** Ranked alternatives, best first, including `best`. */
  ranked: ElementMatch[];
  /** True when the top two are within `AMBIGUITY_MARGIN` and nothing separates them. */
  ambiguous: boolean;
}

@Injectable()
export class ElementMatcherService {
  /**
   * Flatten a locator record into the shape the matcher compares against.
   *
   * The scanner's element snapshot is stored on the record precisely so that
   * matching does not need to re-read the scan: everything the step could name
   * — label, placeholder, role, input type, containers, heading — is here.
   */
  toMatchable(record: LocatorRecord): MatchableElement {
    const snapshot = (record.elementSnapshot ?? {}) as Record<string, unknown>;
    const attributes = (snapshot.attributes ?? {}) as Record<string, unknown>;
    const context = (snapshot.context ?? {}) as Record<string, unknown>;
    const scopes = (context.scopes as { role?: string; name?: string; label?: string }[]) ?? [];
    return {
      locatorId: record.id,
      scannedElementId: record.scannedElementId ?? '',
      elementKey: record.elementKey,
      elementName: record.elementName,
      accessibleName: String(snapshot.accessibleName ?? ''),
      associatedLabel: String(context.associatedLabel ?? ''),
      placeholder: String(attributes.placeholder ?? ''),
      visibleText: String(snapshot.visibleText ?? ''),
      nameAttribute: String(attributes.name ?? ''),
      role: record.role || String(snapshot.role ?? ''),
      // The scanner stores the input's `type` attribute as `inputType`; `type`
      // is accepted too so a hand-edited snapshot still matches.
      inputType: String(attributes.inputType ?? attributes.type ?? ''),
      tagName: String(snapshot.tagName ?? ''),
      pageName: record.pageName,
      pageUrlPattern: record.pageUrlPattern,
      pageState: record.pageState || '',
      frameKey: record.frameKey || frameKeyOfData(record.locatorData as unknown as LocatorData),
      scopes: scopes.map((s) => ({
        role: String(s.role ?? ''),
        name: String(s.name ?? ''),
        label: s.label ? String(s.label) : undefined,
      })),
      nearestHeading: String(context.nearestHeading ?? ''),
      // The scanner never stores a credential field's value, so the input type
      // is what identifies one here.
      sensitive: String(attributes.type ?? '') === 'password',
      approved: record.approved,
      confidenceScore: record.confidenceScore,
    };
  }

  /**
   * Rank the candidate elements for one step (§3).
   *
   * `candidates` is already scoped to the project; page, frame and page-state
   * filtering happens here so that the reason an element was excluded stays
   * visible in the rationale rather than disappearing into a query.
   */
  match(step: AutomationTestStep, candidates: MatchableElement[]): MatchOutcome {
    const phrase = normaliseName(step.targetPhrase ?? '');
    const tokens = new Set(stepTokens(step.description));
    const allowedRoles = ACTION_ROLES[step.action] ?? [];
    const wantedInputs = step.testDataType
      ? (DATA_TYPE_INPUTS[step.testDataType] ?? [])
      : [];
    const wantedWords = step.testDataType
      ? (DATA_TYPE_WORDS[step.testDataType] ?? [])
      : [];
    const parent = (step.parentContext ?? '').trim().toLowerCase();
    const stepPage = (step.pageName ?? '').trim().toLowerCase();

    const scored: ElementMatch[] = [];
    for (const element of candidates) {
      const rationale: Record<string, unknown> = {};
      let score = 0;
      // Only the signals this step can actually express count towards the
      // denominator, so confidence reads as "how much of what was knowable
      // matched" rather than "how many of every conceivable signal fired".
      let possible = WEIGHTS.tokenOverlap + WEIGHTS.approved + WEIGHTS.confidence;

      // --- page, frame and page state: hard context boundaries -----------
      // These are not preferences. An element on another page, in another
      // frame or captured in another page state is not the step's target, and
      // scoring it would only invite a confident wrong answer.
      const pageVerdict = pageMatches(stepPage, element);
      if (pageVerdict === 'mismatch') continue;
      if (step.pageUrlPattern && element.pageUrlPattern) {
        if (step.pageUrlPattern !== element.pageUrlPattern) continue;
        score += WEIGHTS.pageMatch;
        possible += WEIGHTS.pageMatch;
        rationale.pageUrlPattern = 'exact';
      }
      if (stepPage) {
        possible += WEIGHTS.pageMatch;
        if (pageVerdict === 'match') {
          score += WEIGHTS.pageMatch;
          rationale.page = `page "${element.pageName || element.pageUrlPattern}"`;
        }
      }
      if (step.frameKey !== undefined) {
        if (step.frameKey !== element.frameKey) continue;
        score += WEIGHTS.frameMatch;
        possible += WEIGHTS.frameMatch;
        rationale.frame = element.frameKey || 'main document';
      }
      if (step.pageState !== undefined && step.pageState !== element.pageState) continue;

      // --- role compatibility (§3 "test-step action", "role") -------------
      if (allowedRoles.length) {
        const verdict = actionCompatibility(step.action, element, allowedRoles);
        if (verdict === 'mismatch') continue;
        if (verdict === 'match') {
          score += WEIGHTS.roleMatch;
          possible += WEIGHTS.roleMatch;
          rationale.role = `${element.role || element.tagName} can be ${step.action}ed`;
        }
        // 'unknown' scores nothing and excludes nothing: an element the
        // scanner could give no role to is not thereby the wrong element.
      }

      // --- naming (§3 accessible name, label, placeholder, text, name) ----
      const names = [
        element.accessibleName,
        element.elementName,
        element.associatedLabel,
        element.placeholder,
        element.visibleText,
        element.nameAttribute,
      ]
        .map((n) => normaliseName(n))
        .filter(Boolean);

      if (phrase) {
        possible += WEIGHTS.exactPhrase;
        // An equivalent name is an exact match: "the email field" and a
        // control the scan named "Username" are the same box.
        const equivalent = names.some((n) => namesAreEquivalent(n, phrase));
        const exact = equivalent || names.some((n) => n === phrase);
        const starts = !exact && names.some((n) => n.startsWith(phrase) || phrase.startsWith(n));
        const contains = !exact && !starts && names.some((n) => n.includes(phrase) || phrase.includes(n));
        if (exact) {
          score += WEIGHTS.exactPhrase;
          rationale.name = equivalent
            ? `"${phrase}" is an accepted name for "${names[0]}"`
            : `exact match on "${phrase}"`;
        } else if (starts) {
          score += WEIGHTS.startsWithPhrase;
          rationale.name = `prefix match on "${phrase}"`;
        } else if (contains) {
          score += WEIGHTS.containsPhrase;
          rationale.name = `partial match on "${phrase}"`;
        }
      }

      const elementTokens = new Set(
        names.flatMap((n) => stepTokens(n)).concat(stepTokens(element.role)),
      );
      const overlap = [...elementTokens].filter((t) => tokens.has(t)).length;
      if (overlap && elementTokens.size) {
        const ratio = overlap / Math.min(elementTokens.size, Math.max(tokens.size, 1));
        score += WEIGHTS.tokenOverlap * Math.min(1, ratio);
        rationale.tokenOverlap = overlap;
      }

      // --- test-data type (§3 "input type", "test data type") -------------
      if (wantedInputs.length) {
        possible += WEIGHTS.inputTypeMatch;
        if (element.inputType && wantedInputs.includes(element.inputType)) {
          score += WEIGHTS.inputTypeMatch;
          rationale.inputType = element.inputType;
        }
      }
      if (wantedWords.length) {
        possible += WEIGHTS.dataWordMatch;
        const hay = names.join(' ');
        if (wantedWords.some((w) => hay.includes(w))) {
          score += WEIGHTS.dataWordMatch;
          rationale.dataType = step.testDataType;
        }
      }
      // A step that supplies a password must not land on a plain text field
      // that merely happens to be named "password confirmation hint".
      if (step.testDataType === 'password' && element.inputType && element.inputType !== 'password') {
        score += WEIGHTS.sensitivePenalty;
        rationale.inputType = `excluded: ${element.inputType} is not a password field`;
      }

      // --- container (§3 parent form/dialog/region/row/section) -----------
      if (parent) {
        possible += WEIGHTS.parentContextMatch;
        const scopeNames = containerNames(element.scopes);
        const headed = element.nearestHeading.toLowerCase();
        if (scopeNames.some((n) => namesAgree(n, parent))) {
          score += WEIGHTS.parentContextMatch;
          rationale.parentContext = `inside "${step.parentContext}"`;
        } else if (headed && namesAgree(headed, parent)) {
          score += WEIGHTS.headingMatch;
          rationale.nearestHeading = element.nearestHeading;
        } else {
          // The step named a container this element is not in. That is a real
          // signal, not a neutral one: "Save in the Profile section" must not
          // resolve to the Save button of the Billing section.
          score += WEIGHTS.parentContextMissing;
          rationale.parentContext = `not inside "${step.parentContext}"`;
        }
      }

      // --- provenance -----------------------------------------------------
      if (element.approved) score += WEIGHTS.approved;
      score += WEIGHTS.confidence * clamp01(element.confidenceScore);

      if (score <= 0) continue;
      const confidence = clamp01(score / Math.max(possible, 1));
      scored.push({ element, confidence, rationale });
    }

    scored.sort((a, b) => b.confidence - a.confidence);
    const best = scored[0] ?? null;
    const runnerUp = scored[1];
    const ambiguous =
      !!best &&
      !!runnerUp &&
      best.confidence - runnerUp.confidence < AMBIGUITY_MARGIN &&
      !sameElement(best.element, runnerUp.element);

    return { best, ranked: scored.slice(0, 5), ambiguous };
  }
}

/**
 * Whether two equally-scored candidates are in fact the same control.
 *
 * A tie between two locators for one element is harmless — either reaches the
 * right thing. A tie between two *different* elements means the step did not
 * say which one it meant, and the caller must ask for review rather than pick
 * one by position (§3).
 */
function sameElement(a: MatchableElement, b: MatchableElement): boolean {
  return a.elementKey === b.elementKey;
}

/**
 * Tags an interaction can drive when the element carries no ARIA role.
 *
 * Some perfectly ordinary controls have no implicit role at all —
 * `input[type=password]` is the one that matters most here. Excluding them for
 * lacking a role would leave a password step permanently unresolvable, so the
 * tag stands in for the role in exactly those cases.
 */
const ACTION_TAGS: Partial<Record<StepAction, string[]>> = {
  fill: ['input', 'textarea'],
  press: ['input', 'textarea', 'button'],
  click: ['button', 'a', 'input', 'summary', 'label'],
  check: ['input'],
  select: ['select'],
  upload: ['input'],
};

/**
 * Whether an element can perform a step's interaction (§3).
 *
 * `'mismatch'` only when the element has a role that cannot do it — a missing
 * role is `'unknown'`, which neither helps nor excludes.
 */
function actionCompatibility(
  action: StepAction,
  element: MatchableElement,
  allowedRoles: string[],
): 'match' | 'mismatch' | 'unknown' {
  if (element.role) {
    return allowedRoles.includes(element.role) ? 'match' : 'mismatch';
  }
  const tags = ACTION_TAGS[action] ?? [];
  return tags.includes(element.tagName.toLowerCase()) ? 'match' : 'unknown';
}

/**
 * Roles that identify a *section of a page* rather than the page itself.
 *
 * `main`, `banner` and `contentinfo` are deliberately absent. Their accessible
 * name is computed from their contents, so on a typical page the `main`
 * landmark is "named" after every word on the screen — which would make every
 * element "inside the Profile section" and turn the strongest disambiguator
 * this matcher has into noise.
 */
const CONTAINER_ROLES = new Set([
  'dialog',
  'alertdialog',
  'region',
  'form',
  'group',
  'row',
  'listitem',
  'tabpanel',
  'navigation',
  'menu',
  'table',
  'grid',
  'article',
  'toolbar',
  'list',
]);

/** Longest container name still plausible as a section label, not page text. */
const MAX_CONTAINER_NAME = 60;

/** Nearest named containers of an element, closest first (§3). */
function containerNames(scopes: MatchableElement['scopes']): string[] {
  return scopes
    .filter((scope) => CONTAINER_ROLES.has(scope.role))
    .flatMap((scope) => [scope.name, scope.label ?? ''])
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name && name.length <= MAX_CONTAINER_NAME)
    .slice(0, 4);
}

/** Whether two names refer to the same thing, on whole words only. */
function namesAgree(candidate: string, wanted: string): boolean {
  if (candidate === wanted) return true;
  const boundary = (haystack: string, needle: string): boolean =>
    new RegExp(`(^|\\W)${escapeRegExp(needle)}($|\\W)`).test(haystack);
  return boundary(candidate, wanted) || boundary(wanted, candidate);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether an element is on the page a step named.
 *
 * `'unknown'` when the step names no page, or when the element carries no page
 * of its own — an unnamed page is not evidence against a match, whereas a
 * *different* named page is.
 */
function pageMatches(
  stepPage: string,
  element: MatchableElement,
): 'match' | 'mismatch' | 'unknown' {
  if (!stepPage) return 'unknown';
  const elementPage = element.pageName.trim().toLowerCase();
  if (
    elementPage &&
    (elementPage === stepPage ||
      elementPage.includes(stepPage) ||
      stepPage.includes(elementPage))
  ) {
    return 'match';
  }
  const patternTail = lastPathSegment(element.pageUrlPattern);
  if (patternTail && stepPage.replace(/\s+/g, '-').includes(patternTail)) return 'match';
  return elementPage ? 'mismatch' : 'unknown';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lastPathSegment(pattern: string): string {
  const parts = (pattern || '').split('/').filter(Boolean);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

function frameKeyOfData(data: LocatorData | null | undefined): string {
  return (data?.frame?.path ?? []).join(' >> ');
}
