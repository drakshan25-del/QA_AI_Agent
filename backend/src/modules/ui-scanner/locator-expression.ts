import { ValidationFailedException } from '../../common/errors';
import { LOCATOR_STRATEGIES, LocatorStrategy } from '../../common/enums';
import {
  FrameDefinition,
  LocatorData,
  LocatorDefinition,
} from './ui-scanner.types';

/**
 * Rendering and validation of machine-readable locators (FR-UIS-010).
 *
 * A locator is stored twice — as structured `locatorData` and as displayable
 * Playwright code. Only the structured form is ever executed (the engine
 * rebuilds it through the Playwright API); the code strings exist purely to be
 * read, copied and pasted into generated tests. That is why the code is
 * *rendered from* the data here rather than parsed into it: a user editing a
 * locator edits the structure, and the expression follows deterministically,
 * so there is never a string that has to be turned back into behaviour
 * (SEC-005 — no eval anywhere in this feature).
 *
 * These renderers are the TypeScript twin of
 * `engine/uiscanner/locator_generator.py`; both must produce identical output
 * for identical data, which `locator-expression.spec.ts` pins down.
 */

const STRATEGIES = new Set<string>(LOCATOR_STRATEGIES);

function tsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function pyString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderChainTs(data: LocatorDefinition): string {
  if (data.strategy === 'scopedRole') {
    if (!data.parent || !data.child) return '';
    return renderChainTs(data.parent) + renderChainTs(data.child);
  }
  const name = data.name || '';
  const value = data.value || '';
  const selector = data.selector || '';
  switch (data.strategy) {
    case 'role': {
      const args = [tsString(data.role || '')];
      if (name) {
        const opts =
          `name: ${tsString(name)}` +
          (data.exact === undefined ? '' : `, exact: ${data.exact ? 'true' : 'false'}`);
        args.push(`{ ${opts} }`);
      }
      return `.getByRole(${args.join(', ')})`;
    }
    case 'label':
      return `.getByLabel(${tsString(value)}, { exact: true })`;
    case 'placeholder':
      return `.getByPlaceholder(${tsString(value)}, { exact: true })`;
    case 'text':
      return `.getByText(${tsString(value)}, { exact: true })`;
    case 'testId':
      return data.attribute === 'data-testid'
        ? `.getByTestId(${tsString(value)})`
        : `.locator(${tsString(selector)})`;
    default:
      return `.locator(${tsString(selector)})`;
  }
}

function renderChainPy(data: LocatorDefinition): string {
  if (data.strategy === 'scopedRole') {
    if (!data.parent || !data.child) return '';
    return renderChainPy(data.parent) + renderChainPy(data.child);
  }
  const name = data.name || '';
  const value = data.value || '';
  const selector = data.selector || '';
  switch (data.strategy) {
    case 'role': {
      const args = [pyString(data.role || '')];
      if (name) {
        args.push(`name=${pyString(name)}`);
        if (data.exact !== undefined) args.push(`exact=${data.exact ? 'True' : 'False'}`);
      }
      return `.get_by_role(${args.join(', ')})`;
    }
    case 'label':
      return `.get_by_label(${pyString(value)}, exact=True)`;
    case 'placeholder':
      return `.get_by_placeholder(${pyString(value)}, exact=True)`;
    case 'text':
      return `.get_by_text(${pyString(value)}, exact=True)`;
    case 'testId':
      return data.attribute === 'data-testid'
        ? `.get_by_test_id(${pyString(value)})`
        : `.locator(${pyString(selector)})`;
    default:
      return `.locator(${pyString(selector)})`;
  }
}

function framePrefix(
  frame: FrameDefinition | null | undefined,
  method: string,
  quote: (v: string) => string,
): string {
  return (frame?.path ?? []).map((selector) => `.${method}(${quote(selector)})`).join('');
}

/** Displayable TypeScript Playwright code for a locator. */
export function renderExpression(data: LocatorData, root = 'page'): string {
  return root + framePrefix(data.frame, 'frameLocator', tsString) + renderChainTs(data);
}

/** The same locator as sync-Python code, the form this repo's tests use. */
export function renderPythonExpression(data: LocatorData, root = 'page'): string {
  return root + framePrefix(data.frame, 'frame_locator', pyString) + renderChainPy(data);
}

function normaliseDefinition(
  input: Record<string, unknown>,
  depth = 0,
): LocatorDefinition {
  if (depth > 3) {
    throw new ValidationFailedException('The locator is nested too deeply.');
  }
  const strategy = String(input.strategy || '');
  if (!STRATEGIES.has(strategy)) {
    throw new ValidationFailedException(
      `"${strategy || 'missing'}" is not a supported locator strategy.`,
      { allowed: [...STRATEGIES] },
    );
  }
  const definition: LocatorDefinition = {
    strategy: strategy as LocatorStrategy,
    role: input.role ? String(input.role) : null,
    name: input.name ? String(input.name) : null,
    exact: input.exact === undefined ? undefined : Boolean(input.exact),
    value: input.value ? String(input.value) : null,
    selector: input.selector ? String(input.selector) : null,
    attribute: input.attribute ? String(input.attribute) : null,
  };

  if (strategy === 'scopedRole') {
    const parent = input.parent as Record<string, unknown> | undefined;
    const child = input.child as Record<string, unknown> | undefined;
    if (!parent || !child) {
      throw new ValidationFailedException(
        'A scoped locator needs both a parent and a child definition.',
      );
    }
    definition.parent = normaliseDefinition(parent, depth + 1);
    definition.child = normaliseDefinition(child, depth + 1);
    return definition;
  }
  if (strategy === 'role' && !definition.role) {
    throw new ValidationFailedException('A role locator needs a role.');
  }
  if (
    ['label', 'placeholder', 'text'].includes(strategy) &&
    !definition.value
  ) {
    throw new ValidationFailedException(`A ${strategy} locator needs a value.`);
  }
  if (strategy === 'testId' && !definition.value && !definition.selector) {
    throw new ValidationFailedException(
      'A test-id locator needs a value or a selector.',
    );
  }
  if (['name', 'css', 'xpath'].includes(strategy) && !definition.selector) {
    throw new ValidationFailedException(`A ${strategy} locator needs a selector.`);
  }
  return definition;
}

/**
 * Validate a client-supplied locator structure (FR-UIS-022 "locator schema").
 *
 * Anything the engine cannot rebuild is rejected here rather than failing
 * later inside a browser, and the frame chain is length-limited so a hostile
 * payload cannot build an unbounded locator.
 */
export function normaliseLocatorData(input: Record<string, unknown>): LocatorData {
  const definition = normaliseDefinition(input);
  const frameInput = input.frame as Record<string, unknown> | null | undefined;
  let frame: FrameDefinition | null = null;
  if (frameInput && Array.isArray(frameInput.path) && frameInput.path.length) {
    const path = (frameInput.path as unknown[]).map((s) => String(s)).filter(Boolean);
    if (path.length > 5) {
      throw new ValidationFailedException(
        'The locator addresses more than five nested frames.',
      );
    }
    frame = {
      path,
      url: String(frameInput.url ?? ''),
      name: String(frameInput.name ?? ''),
      title: String(frameInput.title ?? ''),
      selector: String(frameInput.selector ?? ''),
      parentIndex: Number(frameInput.parentIndex ?? -1),
      index: Number(frameInput.index ?? 0),
    };
  }
  return { ...definition, frame };
}
