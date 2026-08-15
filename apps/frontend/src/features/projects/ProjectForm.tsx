import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { TextInput, TextArea, Select } from '../../components/ui/Field';
import {
  CLOUD_PROVIDERS,
  LOCAL_MODEL_SUGGESTIONS,
  type CreateProjectInput,
  type LlmType,
  type Runner,
} from '../../services/api/types';
import L from '../../styles/layout.module.css';

export interface ProjectFormValues extends CreateProjectInput {
  name: string;
}

const DEFAULTS: ProjectFormValues = {
  name: '',
  description: '',
  baseUrl: '',
  apiBaseUrl: '',
  allowedDomains: 'localhost,127.0.0.1',
  repository: '',
  environment: 'test',
  llmType: 'LOCAL',
  llmModel: '',
  llmTemperature: 0.1,
  cloudProvider: 'openai',
  cloudModel: '',
  cloudApiKey: '',
  cloudBaseUrl: '',
  runner: 'pytest',
};

interface LlmErrors {
  llmModel?: string;
  cloudProvider?: string;
  cloudModel?: string;
  cloudApiKey?: string;
  cloudBaseUrl?: string;
}

/** Visually dims and disables the inactive LLM configuration block. */
function ModeSection({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <fieldset
      disabled={!active}
      style={{
        border: 'none',
        margin: 0,
        padding: 0,
        opacity: active ? 1 : 0.45,
        transition: 'opacity 120ms ease',
      }}
    >
      {children}
    </fieldset>
  );
}

/**
 * Project configuration form (FR-PROJ-*): base URL, allowed domains (SEC-003),
 * repository, environment, LLM configuration (local Ollama vs cloud provider)
 * and runner. Shared by the create and settings pages.
 */
export function ProjectForm({
  initial,
  submitLabel,
  onSubmit,
  submitting,
  hasSavedApiKey,
}: {
  initial?: Partial<ProjectFormValues>;
  submitLabel: string;
  onSubmit: (values: ProjectFormValues) => void;
  submitting?: boolean;
  /** Settings page: an API key is already stored; blank input keeps it. */
  hasSavedApiKey?: boolean;
}): JSX.Element {
  const [values, setValues] = useState<ProjectFormValues>({ ...DEFAULTS, ...initial });
  const [nameError, setNameError] = useState<string>();
  const [llmErrors, setLlmErrors] = useState<LlmErrors>({});
  const [showApiKey, setShowApiKey] = useState(false);

  const useLocal = (values.llmType ?? 'LOCAL') === 'LOCAL';
  const provider = CLOUD_PROVIDERS.find((p) => p.id === values.cloudProvider);

  const set = <K extends keyof ProjectFormValues>(key: K, v: ProjectFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const setLlmType = (type: LlmType) => {
    // Values of the now-inactive mode are kept (switching back must not lose
    // input); only its validation errors are cleared.
    setLlmErrors({});
    set('llmType', type);
  };

  const validateLlm = (): LlmErrors => {
    const errors: LlmErrors = {};
    if (useLocal) {
      if (!values.llmModel?.trim()) {
        errors.llmModel = 'Select or enter a local model.';
      }
    } else {
      if (!values.cloudProvider) {
        errors.cloudProvider = 'Select a cloud provider.';
      }
      if (!values.cloudModel?.trim()) {
        errors.cloudModel = 'Enter the cloud model name.';
      }
      if (!values.cloudApiKey?.trim() && !hasSavedApiKey) {
        errors.cloudApiKey = 'Enter the API key for this provider.';
      }
      if (provider && !provider.defaultBaseUrl && !values.cloudBaseUrl?.trim()) {
        errors.cloudBaseUrl = 'A base URL is required for a custom provider.';
      }
      if (
        values.cloudBaseUrl?.trim() &&
        !/^https?:\/\//.test(values.cloudBaseUrl.trim())
      ) {
        errors.cloudBaseUrl = 'The base URL must start with http:// or https://.';
      }
    }
    return errors;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const nameMissing = !values.name.trim();
    setNameError(nameMissing ? 'Project name is required.' : undefined);
    const errors = validateLlm();
    setLlmErrors(errors);
    if (nameMissing || Object.keys(errors).length > 0) return;

    // Only the active LLM configuration is submitted; the inactive side's
    // fields are dropped so disabled inputs never reach the API.
    const {
      llmModel,
      cloudProvider,
      cloudModel,
      cloudApiKey,
      cloudBaseUrl,
      ...base
    } = values;
    if (useLocal) {
      onSubmit({ ...base, llmType: 'LOCAL', llmModel });
    } else {
      onSubmit({
        ...base,
        llmType: 'CLOUD',
        cloudProvider,
        cloudModel,
        cloudBaseUrl,
        // Blank means "keep the saved key" on the settings page.
        ...(cloudApiKey?.trim() ? { cloudApiKey: cloudApiKey.trim() } : {}),
      });
    }
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
          label="API base URL"
          value={values.apiBaseUrl ?? ''}
          onChange={(e) => set('apiBaseUrl', e.target.value)}
          placeholder="http://localhost:3000/api"
          hint="Where the API under test is served, if it differs from the base URL — generated API tests send requests here"
        />
      </div>
      <TextInput
        label="Allowed domains"
        value={values.allowedDomains ?? ''}
        onChange={(e) => set('allowedDomains', e.target.value)}
        placeholder="localhost,127.0.0.1"
        hint="Comma-separated navigation allow-list (SEC-003)"
      />
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

      <label className={L.row} style={{ gap: 8, alignItems: 'center', margin: '14px 0 4px' }}>
        <input
          type="checkbox"
          role="switch"
          aria-checked={useLocal}
          checked={useLocal}
          onChange={(e) => setLlmType(e.target.checked ? 'LOCAL' : 'CLOUD')}
        />
        <strong>Use Local LLM</strong>
        <span className={L.muted}>
          {useLocal
            ? 'Runs using an LLM installed on this machine.'
            : 'Uses the selected cloud provider and may incur usage charges.'}
        </span>
      </label>

      <ModeSection active={useLocal}>
        <div className={L.split}>
          <TextInput
            label="Local LLM model"
            value={values.llmModel ?? ''}
            error={useLocal ? llmErrors.llmModel : undefined}
            onChange={(e) => {
              set('llmModel', e.target.value);
              setLlmErrors((prev) => ({ ...prev, llmModel: undefined }));
            }}
            placeholder="qwen2.5:latest"
            list="local-model-suggestions"
            hint="Any model pulled into Ollama"
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
        <datalist id="local-model-suggestions">
          {LOCAL_MODEL_SUGGESTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </ModeSection>

      <ModeSection active={!useLocal}>
        <div className={L.split}>
          <Select
            label="Cloud provider"
            value={values.cloudProvider ?? 'openai'}
            error={!useLocal ? llmErrors.cloudProvider : undefined}
            onChange={(e) => {
              set('cloudProvider', e.target.value);
              setLlmErrors((prev) => ({
                ...prev,
                cloudProvider: undefined,
                cloudBaseUrl: undefined,
              }));
            }}
          >
            {CLOUD_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <TextInput
            label="Cloud model"
            value={values.cloudModel ?? ''}
            error={!useLocal ? llmErrors.cloudModel : undefined}
            onChange={(e) => {
              set('cloudModel', e.target.value);
              setLlmErrors((prev) => ({ ...prev, cloudModel: undefined }));
            }}
            placeholder={provider?.exampleModels[0] ?? 'model name'}
            list="cloud-model-suggestions"
          />
        </div>
        <datalist id="cloud-model-suggestions">
          {(provider?.exampleModels ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <div className={L.split}>
          <div style={{ position: 'relative' }}>
            <TextInput
              label="Cloud LLM API key"
              type={showApiKey ? 'text' : 'password'}
              autoComplete="new-password"
              value={values.cloudApiKey ?? ''}
              error={!useLocal ? llmErrors.cloudApiKey : undefined}
              onChange={(e) => {
                set('cloudApiKey', e.target.value);
                setLlmErrors((prev) => ({ ...prev, cloudApiKey: undefined }));
              }}
              placeholder={hasSavedApiKey ? '•••••••• (saved — leave blank to keep)' : 'sk-…'}
              hint="Stored encrypted; never displayed again"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((s) => !s)}
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              className={L.muted}
              style={{
                position: 'absolute',
                right: 8,
                top: 30,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <TextInput
            label="Cloud base URL (optional)"
            value={values.cloudBaseUrl ?? ''}
            error={!useLocal ? llmErrors.cloudBaseUrl : undefined}
            onChange={(e) => {
              set('cloudBaseUrl', e.target.value);
              setLlmErrors((prev) => ({ ...prev, cloudBaseUrl: undefined }));
            }}
            placeholder={provider?.defaultBaseUrl || 'https://my-gateway.example.com/v1'}
            hint={
              provider?.supportsCustomBaseUrl
                ? 'Required for a custom endpoint — include the API path (e.g. /v1)'
                : `Leave blank to use ${provider?.defaultBaseUrl || 'the provider endpoint'}`
            }
          />
        </div>
      </ModeSection>

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
