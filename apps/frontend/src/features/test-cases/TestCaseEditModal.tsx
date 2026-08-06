import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { TextInput, TextArea, Select } from '../../components/ui/Field';
import { ErrorBanner } from '../../components/ui/Banner';
import type { TestCase } from '../../services/api/types';

/** Inline edit of a single test case (FR-TC-008). */
export function TestCaseEditModal({
  testCase,
  open,
  onClose,
  onSave,
  saving,
  error,
}: {
  testCase: TestCase;
  open: boolean;
  onClose: () => void;
  onSave: (patch: Partial<TestCase>) => void;
  saving?: boolean;
  error?: unknown;
}): JSX.Element {
  const [title, setTitle] = useState(testCase.title);
  const [objective, setObjective] = useState(testCase.objective);
  const [priority, setPriority] = useState(testCase.priority);
  const [category, setCategory] = useState(testCase.category);
  const [steps, setSteps] = useState((testCase.steps ?? []).join('\n'));
  const [expected, setExpected] = useState((testCase.expectedResults ?? []).join('\n'));

  const save = () =>
    onSave({
      title,
      objective,
      priority,
      category,
      steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
      expectedResults: expected.split('\n').map((s) => s.trim()).filter(Boolean),
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${testCase.caseKey || testCase.title}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      {error != null && <ErrorBanner error={error} />}
      <TextInput label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextArea label="Objective" value={objective} onChange={(e) => setObjective(e.target.value)} />
      <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
        {['critical', 'high', 'medium', 'low'].map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
        {['positive', 'negative', 'edge', 'boundary', 'security', 'performance'].map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <TextArea
        label="Steps (one per line)"
        value={steps}
        onChange={(e) => setSteps(e.target.value)}
      />
      <TextArea
        label="Expected results (one per line)"
        value={expected}
        onChange={(e) => setExpected(e.target.value)}
      />
    </Modal>
  );
}
