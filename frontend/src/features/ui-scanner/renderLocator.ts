/**
 * Client-side preview of a hand-edited locator.
 *
 * The authoritative rendering happens on the backend
 * (`modules/ui-scanner/locator-expression.ts`) — this is only so the edit
 * dialog can show what the structure will compile to before it is saved. Both
 * renderers are driven by the same `locatorData` shape, so what is previewed is
 * what is stored.
 */
import type { LocatorData } from '../../services/api/types';

function tsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function chain(data: LocatorData): string {
  if (data.strategy === 'scopedRole') {
    if (!data.parent || !data.child) return '';
    return chain(data.parent) + chain(data.child);
  }
  const name = data.name || '';
  const value = data.value || '';
  const selector = data.selector || '';
  switch (data.strategy) {
    case 'role': {
      const args = [tsString(data.role || '')];
      if (name) {
        args.push(
          `{ name: ${tsString(name)}${
            data.exact === undefined ? '' : `, exact: ${data.exact ? 'true' : 'false'}`
          } }`,
        );
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

export function previewExpression(data: LocatorData, root = 'page'): string {
  const frames = (data.frame?.path ?? [])
    .map((selector) => `.frameLocator(${tsString(selector)})`)
    .join('');
  return root + frames + chain(data);
}
