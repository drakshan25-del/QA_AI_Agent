import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { humanCategory } from '../../lib/format';
import L from '../../styles/layout.module.css';

interface EditableSection {
  key: string;
  /** Editable text representation. */
  text: string;
  /** Whether the original value was a plain string (vs JSON). */
  isString: boolean;
}

function toSections(sections: Record<string, unknown>): EditableSection[] {
  return Object.entries(sections).map(([key, value]) => ({
    key,
    isString: typeof value === 'string',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }));
}

function fromSections(edited: EditableSection[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const sec of edited) {
    if (sec.isString) {
      out[sec.key] = sec.text;
    } else {
      try {
        out[sec.key] = JSON.parse(sec.text);
      } catch {
        out[sec.key] = sec.text;
      }
    }
  }
  return out;
}

/**
 * Structured, editable test-plan section editor (FR-TP-004). Each top-level
 * section is edited independently; array/object sections are edited as JSON and
 * re-parsed on save (falling back to raw text if invalid).
 */
export function SectionEditor({
  sections,
  disabled,
  saving,
  onSave,
}: {
  sections: Record<string, unknown>;
  disabled?: boolean;
  saving?: boolean;
  onSave: (sections: Record<string, unknown>) => void;
}): JSX.Element {
  const initial = useMemo(() => toSections(sections), [sections]);
  const [edited, setEdited] = useState<EditableSection[]>(initial);
  const [dirty, setDirty] = useState(false);
  // Refetches produce a new `sections` object identity even when deep-equal
  // (live invalidations fire while jobs run). Reseed only when the content
  // actually changed AND there are no unsaved edits — a reviewer's
  // in-progress text must never be silently wiped by a background refetch.
  const contentKey = useMemo(() => JSON.stringify(initial), [initial]);
  const seededKeyRef = useRef(contentKey);
  useEffect(() => {
    if (seededKeyRef.current === contentKey) return;
    if (dirty) return;
    seededKeyRef.current = contentKey;
    setEdited(initial);
  }, [contentKey, initial, dirty]);

  const update = (key: string, text: string) => {
    setEdited((prev) => prev.map((s) => (s.key === key ? { ...s, text } : s)));
    setDirty(true);
  };

  if (edited.length === 0) {
    return <p className={L.muted}>This plan has no structured sections.</p>;
  }

  return (
    <div className={L.stack}>
      {edited.map((sec) => (
        <div key={sec.key}>
          <label
            htmlFor={`sec-${sec.key}`}
            style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}
          >
            {humanCategory(sec.key)}
          </label>
          <textarea
            id={`sec-${sec.key}`}
            value={sec.text}
            disabled={disabled}
            onChange={(e) => update(sec.key, e.target.value)}
            style={{
              width: '100%',
              minHeight: sec.isString ? 70 : 120,
              padding: 10,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontFamily: sec.isString ? 'inherit' : 'var(--font-mono)',
              fontSize: sec.isString ? 14 : 12.5,
              resize: 'vertical',
            }}
          />
        </div>
      ))}
      <div>
        <Button
          variant="primary"
          disabled={disabled || !dirty || saving}
          loading={saving}
          onClick={() => {
            setDirty(false);
            onSave(fromSections(edited));
          }}
        >
          Save sections
        </Button>
        {dirty && <span className={L.muted} style={{ marginLeft: 10 }}>Unsaved changes</span>}
      </div>
    </div>
  );
}
