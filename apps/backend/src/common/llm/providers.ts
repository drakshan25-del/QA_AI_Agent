/**
 * Per-project LLM configuration model (FR-PROJ-*): a project runs either on
 * the local Ollama install (`LOCAL`, the historical behaviour) or on a cloud
 * provider (`CLOUD`). Cloud access goes through the engine's OpenAI-compatible
 * client, so any provider here only needs a chat-completions base URL.
 */

export const LLM_TYPES = ['LOCAL', 'CLOUD'] as const;
export type LlmType = (typeof LLM_TYPES)[number];

export interface CloudProviderInfo {
  id: string;
  label: string;
  /** Default OpenAI-compatible endpoint; empty = user must supply one. */
  defaultBaseUrl: string;
  /** Whether a custom base URL override makes sense for this provider. */
  supportsCustomBaseUrl: boolean;
}

/**
 * Cloud providers the engine can talk to. All are OpenAI-compatible
 * chat-completions endpoints; `custom` covers self-hosted or proxy gateways.
 * Model names are free-form — providers add models weekly, so the UI offers
 * suggestions but never restricts input.
 */
export const CLOUD_PROVIDERS: CloudProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsCustomBaseUrl: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    supportsCustomBaseUrl: false,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    supportsCustomBaseUrl: false,
  },
  {
    id: 'groq',
    label: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    supportsCustomBaseUrl: false,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    defaultBaseUrl: '',
    supportsCustomBaseUrl: true,
  },
];

export const CLOUD_PROVIDER_IDS = CLOUD_PROVIDERS.map((p) => p.id);

export function cloudProviderById(id: string): CloudProviderInfo | undefined {
  return CLOUD_PROVIDERS.find((p) => p.id === id);
}
