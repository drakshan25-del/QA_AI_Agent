import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectForm } from './ProjectForm';

const onSubmit = vi.fn();

function renderForm(props: Partial<Parameters<typeof ProjectForm>[0]> = {}) {
  return render(
    <ProjectForm submitLabel="Create project" onSubmit={onSubmit} {...props} />,
  );
}

const toggle = () => screen.getByRole('switch', { name: /use local llm/i });

describe('ProjectForm LLM configuration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts in Local mode: local field enabled, cloud fields disabled', () => {
    renderForm();
    expect(toggle()).toBeChecked();
    expect(screen.getByLabelText('Local LLM model')).toBeEnabled();
    expect(screen.getByLabelText('Cloud provider')).toBeDisabled();
    expect(screen.getByLabelText('Cloud model')).toBeDisabled();
    expect(screen.getByLabelText('Cloud LLM API key')).toBeDisabled();
    expect(screen.getByText('Runs using an LLM installed on this machine.')).toBeInTheDocument();
  });

  it('switching the toggle off enables cloud fields and disables local ones', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(toggle());
    expect(screen.getByLabelText('Local LLM model')).toBeDisabled();
    expect(screen.getByLabelText('Cloud provider')).toBeEnabled();
    expect(screen.getByLabelText('Cloud model')).toBeEnabled();
    expect(screen.getByLabelText('Cloud LLM API key')).toBeEnabled();
    expect(
      screen.getByText('Uses the selected cloud provider and may incur usage charges.'),
    ).toBeInTheDocument();
  });

  it('requires a local model in Local mode', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/project name/i), 'P1');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Select or enter a local model.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('requires cloud model and API key in Cloud mode', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/project name/i), 'P1');
    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Enter the cloud model name.')).toBeInTheDocument();
    expect(screen.getByText('Enter the API key for this provider.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a LOCAL project without any cloud fields', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/project name/i), 'Local P');
    await user.type(screen.getByLabelText('Local LLM model'), 'qwen2.5-coder:latest');
    // Cloud data typed earlier must not leak into a LOCAL submit.
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.llmType).toBe('LOCAL');
    expect(payload.llmModel).toBe('qwen2.5-coder:latest');
    expect(payload).not.toHaveProperty('cloudProvider');
    expect(payload).not.toHaveProperty('cloudModel');
    expect(payload).not.toHaveProperty('cloudApiKey');
    expect(payload).not.toHaveProperty('cloudBaseUrl');
  });

  it('submits a CLOUD project with provider, model and key but no local model', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/project name/i), 'Cloud P');
    await user.click(toggle());
    await user.selectOptions(screen.getByLabelText('Cloud provider'), 'groq');
    await user.type(screen.getByLabelText('Cloud model'), 'llama-3.3-70b-versatile');
    await user.type(screen.getByLabelText('Cloud LLM API key'), 'gsk-test-key');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.llmType).toBe('CLOUD');
    expect(payload.cloudProvider).toBe('groq');
    expect(payload.cloudModel).toBe('llama-3.3-70b-versatile');
    expect(payload.cloudApiKey).toBe('gsk-test-key');
    expect(payload).not.toHaveProperty('llmModel');
  });

  it('keeps entered values when switching modes back and forth', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Local LLM model'), 'qwen3:8b');
    await user.click(toggle()); // → cloud
    await user.type(screen.getByLabelText('Cloud model'), 'gpt-4o-mini');
    await user.click(toggle()); // → back to local
    expect(screen.getByLabelText('Local LLM model')).toHaveValue('qwen3:8b');
    await user.click(toggle()); // → cloud again
    expect(screen.getByLabelText('Cloud model')).toHaveValue('gpt-4o-mini');
  });

  it('clears mode-specific validation errors when switching modes', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/project name/i), 'P1');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Select or enter a local model.')).toBeInTheDocument();
    await user.click(toggle());
    expect(screen.queryByText('Select or enter a local model.')).not.toBeInTheDocument();
  });

  it('show/hide reveals the API key input', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(toggle());
    const key = screen.getByLabelText('Cloud LLM API key');
    expect(key).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(key).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide API key' }));
    expect(key).toHaveAttribute('type', 'password');
  });

  it('with a saved key, a blank key field submits without cloudApiKey (kept server-side)', async () => {
    const user = userEvent.setup();
    renderForm({
      hasSavedApiKey: true,
      initial: {
        name: 'Existing',
        llmType: 'CLOUD',
        cloudProvider: 'openai',
        cloudModel: 'gpt-4o-mini',
      },
    });
    expect(toggle()).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('cloudApiKey');
  });

  it('requires a base URL for the custom provider', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/project name/i), 'P1');
    await user.click(toggle());
    await user.selectOptions(screen.getByLabelText('Cloud provider'), 'custom');
    await user.type(screen.getByLabelText('Cloud model'), 'm');
    await user.type(screen.getByLabelText('Cloud LLM API key'), 'k');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(
      await screen.findByText('A base URL is required for a custom provider.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
