import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextInput, TextArea, Select } from '../../components/ui/Field';
import type { CreateProjectInput, Runner } from '../../services/api/types';
import L from '../../styles/layout.module.css';

export interface ProjectFormValues extends CreateProjectInput {
  name: string;
}

const DEFAULTS: ProjectFormValues = {
  name: '',
  description: '',
  baseUrl: '',
  allowedDomains: 'localhost,127.0.0.1',
  repository: '',
  environment: 'test',
  llmModel: '',
  llmTemperature: 0.1,
  runner: 'pytest',
};

/**
 * Project configuration form (FR-PROJ-*): base URL, allowed domains (SEC-003),
 * repository, environment, LLM model/temperature and runner. Shared by the
 * create and settings pages.
 */
export function ProjectForm({
  initial,
  submitLabel,
  onSubmit,
  submitting,
}: {
  initial?: Partial<ProjectFormValues>;
  submitLabel: string;
  onSubmit: (values: ProjectFormValues) => void;
  submitting?: boolean;
}): JSX.Element {
  const [values, setValues] = useState<ProjectFormValues>({ ...DEFAULTS, ...initial });
  const [nameError, setNameError] = useState<string>();

  const set = <K extends keyof ProjectFormValues>(key: K, v: ProjectFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!values.name.trim()) {
      setNameError('Project name is required.');
      return;
    }
    setNameError(undefined);
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit}>
      <TextInput
        label="Project name"
        required
        value={values.name}
        error={nameError}
        onChange={(e) => set('name', e.target.value)}
        placeholder="Checkout flow QA"
      />
      <TextArea
        label="Description"
        value={values.description ?? ''}
        onChange={(e) => set('description', e.target.value)}
        placeholder="What this project covers"
      />
      <div className={L.split}>
        <TextInput
          label="Base URL"
          value={values.baseUrl ?? ''}
          onChange={(e) => set('baseUrl', e.target.value)}
          placeholder="http://localhost:8001"
          hint="Target application the agents test against"
        />
        <TextInput
          label="Allowed domains"
          value={values.allowedDomains ?? ''}
          onChange={(e) => set('allowedDomains', e.target.value)}
          placeholder="localhost,127.0.0.1"
          hint="Comma-separated navigation allow-list (SEC-003)"
        />
      </div>
      <div className={L.split}>
        <TextInput
          label="Repository"
          value={values.repository ?? ''}
          onChange={(e) => set('repository', e.target.value)}
          placeholder="owner/repo"
        />
        <TextInput
          label="Environment"
          value={values.environment ?? ''}
          onChange={(e) => set('environment', e.target.value)}
          placeholder="test"
        />
      </div>
      <div className={L.split}>
        <TextInput
          label="LLM model"
          value={values.llmModel ?? ''}
          onChange={(e) => set('llmModel', e.target.value)}
          placeholder="qwen2.5:latest"
        />
        <TextInput
          label="LLM temperature"
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={String(values.llmTemperature ?? 0.1)}
          onChange={(e) => set('llmTemperature', Number(e.target.value))}
        />
      </div>
      <Select
        label="Runner"
        value={values.runner ?? 'pytest'}
        onChange={(e) => set('runner', e.target.value as Runner)}
      >
        <option value="pytest">pytest</option>
        <option value="playwright-test">playwright-test</option>
      </Select>

      <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
