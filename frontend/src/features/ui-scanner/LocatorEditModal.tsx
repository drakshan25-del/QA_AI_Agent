/**
 * Hand-edit an element's locator (FR-UIS-018).
 *
 * The edit is structural, not textual: the user picks a strategy and fills the
 * fields that strategy needs, and the Playwright code is rendered from that
 * structure. Nothing here turns a typed string into executable code — the
 * stored `locatorData` is what the engine rebuilds (SEC-005).
 *
 * A saved edit is deliberately marked unvalidated until "Test locator" has run
 * it against the live page, so a hand-written guess is never presented with the
 * confidence of a scanned one.
 */
import { useEffect, useMemo, useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Select, TextInput } from '../../components/ui/Field';
import type {
  LocatorCandidate,
  LocatorData,
  LocatorStrategy,
  ScannedElement,
} from '../../services/api/types';
import { LocatorCode } from './LocatorCode';
import { previewExpression } from './renderLocator';
import L from '../../styles/layout.module.css';

const STRATEGIES: { value: LocatorStrategy; label: string; needs: string }[] = [
  { value: 'role', label: 'Role + accessible name', needs: 'role' },
  { value: 'label', label: 'Label', needs: 'value' },
  { value: 'testId', label: 'Test ID', needs: 'value' },
  { value: 'placeholder', label: 'Placeholder', needs: 'value' },
  { value: 'text', label: 'Visible text', needs: 'value' },
  { value: 'name', label: 'Name attribute (CSS)', needs: 'selector' },
  { value: 'css', label: 'CSS selector', needs: 'selector' },
  { value: 'xpath', label: 'XPath (last resort)', needs: 'selector' },
];

export function LocatorEditModal({
  open,
  element,
  saving,
  onCancel,
  onSave,
}: {
  open: boolean;
  element: ScannedElement | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (data: LocatorData) => void;
}): JSX.Element | null {
  const current: LocatorCandidate | undefined = useMemo(
    () =>
      (element?.candidates ?? []).find(
        (c) => c.id === element?.recommendedLocatorId,
      ) ?? (element?.candidates ?? [])[0],
    [element],
  );

  const [strategy, setStrategy] = useState<LocatorStrategy>('role');
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [exact, setExact] = useState(true);
  const [value, setValue] = useState('');
  const [selector, setSelector] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open || !current) return;
    const data = current.locatorData;
    // A scoped locator is edited through its target; the frame chain is
    // preserved untouched so the locator keeps addressing the right document.
    const leaf = data.strategy === 'scopedRole' ? (data.child ?? data) : data;
    setStrategy(leaf.strategy === 'scopedRole' ? 'role' : leaf.strategy);
    setRole(leaf.role ?? '');
    setName(leaf.name ?? '');
    setExact(leaf.exact ?? true);
    setValue(leaf.value ?? '');
    setSelector(leaf.selector ?? '');
    setDirty(false);
  }, [open, current]);

  const draft: LocatorData = useMemo(
    () => ({
      strategy,
      role: role || null,
      name: name || null,
      exact,
      value: value || null,
      selector: selector || null,
      attribute: strategy === 'testId' ? 'data-testid' : null,
      frame: current?.locatorData.frame ?? null,
    }),
    [strategy, role, name, exact, value, selector, current],
  );

  if (!open || !element) return null;

  const definition = STRATEGIES.find((s) => s.value === strategy);
  const missing =
    (definition?.needs === 'role' && !role) ||
    (definition?.needs === 'value' && !value) ||
    (definition?.needs === 'selector' && !selector);

  const close = () => {
    // Confirm before discarding an edit in progress (FR-UIS-030).
    if (
      dirty &&
      !window.confirm('Discard your changes to this locator?')
    ) {
      return;
    }
    onCancel();
  };

  const track = <T,>(setter: (v: T) => void) => (v: T) => {
    setDirty(true);
    setter(v);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Edit locator"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={missing}
            loading={saving}
            onClick={() => onSave(draft)}
          >
            Save locator
          </Button>
        </>
      }
    >
      <p className={L.muted} style={{ marginTop: 0 }}>
        Editing the locator for{' '}
        <strong>{element.accessibleName || element.elementKey}</strong>.
      </p>

      <Select
        label="Strategy"
        value={strategy}
        onChange={(e) => track(setStrategy)(e.target.value as LocatorStrategy)}
      >
        {STRATEGIES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>

      {strategy === 'role' && (
        <>
          <TextInput
            label="Role"
            value={role}
            onChange={(e) => track(setRole)(e.target.value)}
            placeholder="button"
          />
          <TextInput
            label="Accessible name"
            hint="Leave blank to match the role alone."
            value={name}
            onChange={(e) => track(setName)(e.target.value)}
            placeholder="Login"
          />
          <label
            style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}
          >
            <input
              type="checkbox"
              checked={exact}
              onChange={(e) => track(setExact)(e.target.checked)}
            />
            Match the name exactly
          </label>
        </>
      )}

      {definition?.needs === 'value' && (
        <TextInput
          label={
            strategy === 'testId'
              ? 'Test ID'
              : strategy === 'label'
                ? 'Label text'
                : strategy === 'placeholder'
                  ? 'Placeholder text'
                  : 'Visible text'
          }
          value={value}
          onChange={(e) => track(setValue)(e.target.value)}
        />
      )}

      {definition?.needs === 'selector' && (
        <TextInput
          label={strategy === 'xpath' ? 'XPath expression' : 'CSS selector'}
          hint={
            strategy === 'xpath'
              ? 'Relative XPath only — an absolute path breaks on the first DOM change.'
              : 'Avoid nth-child and generated class names; they change with every build.'
          }
          value={selector}
          onChange={(e) => track(setSelector)(e.target.value)}
          placeholder={strategy === 'xpath' ? '//button[normalize-space()="Save"]' : 'form#login button'}
        />
      )}

      <div style={{ marginTop: 8 }}>
        <div className={L.muted} style={{ fontWeight: 600, marginBottom: 4 }}>
          Preview
        </div>
        <LocatorCode code={previewExpression(draft)} />
      </div>

      {missing && (
        <Banner kind="warn">
          Fill the {definition?.needs} field before saving this locator.
        </Banner>
      )}
      <Banner kind="info">
        A saved edit counts as unvalidated until you run “Test locator” against
        the live page.
      </Banner>
    </Modal>
  );
}
