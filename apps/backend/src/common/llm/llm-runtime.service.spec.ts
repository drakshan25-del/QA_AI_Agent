import { Repository } from 'typeorm';
import { Project } from '../../entities';
import { SecretBoxService } from '../crypto/secret-box.service';
import { LlmRuntimeService } from './llm-runtime.service';

function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    llmType: 'LOCAL',
    llmModel: 'qwen2.5:latest',
    llmTemperature: 0.1,
    cloudProvider: '',
    cloudModel: '',
    cloudBaseUrl: '',
    cloudApiKeyEnc: '',
    hasCloudApiKey: false,
    ...overrides,
  } as Project;
}

describe('LlmRuntimeService', () => {
  const secretBox = {
    open: jest.fn(() => 'sk-decrypted'),
  } as unknown as SecretBoxService;
  const service = new LlmRuntimeService(
    {} as Repository<Project>,
    secretBox,
  );
  const logSpy = jest
    .spyOn(
      (service as unknown as { logger: { log: (m: string) => void } }).logger,
      'log',
    )
    .mockImplementation(() => undefined);

  beforeEach(() => logSpy.mockClear());

  it('maps a LOCAL project to a local engine config', () => {
    const cfg = service.fromProject(projectFixture());
    expect(cfg).toEqual({
      type: 'local',
      model: 'qwen2.5:latest',
      temperature: 0.1,
    });
  });

  it('omits the model for a LOCAL project without one (engine default)', () => {
    const cfg = service.fromProject(projectFixture({ llmModel: '' }));
    expect(cfg.model).toBeUndefined();
  });

  it('maps a CLOUD project with a decrypted key and provider base URL', () => {
    const cfg = service.fromProject(
      projectFixture({
        llmType: 'CLOUD',
        cloudProvider: 'openai',
        cloudModel: 'gpt-4o-mini',
        cloudApiKeyEnc: 'v1.sealed',
        hasCloudApiKey: true,
      }),
    );
    expect(cfg).toEqual({
      type: 'cloud',
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-decrypted',
      baseUrl: 'https://api.openai.com/v1',
      temperature: 0.1,
    });
  });

  it('re-anchors a bare-host override onto the provider API path', () => {
    // Regression: "https://api.anthropic.com" (no /v1) made the SDK call
    // https://api.anthropic.com/chat/completions → provider 404.
    const cfg = service.fromProject(
      projectFixture({
        llmType: 'CLOUD',
        cloudProvider: 'anthropic',
        cloudModel: 'claude-sonnet-5',
        cloudBaseUrl: 'https://api.anthropic.com',
        cloudApiKeyEnc: 'v1.sealed',
      }),
    );
    expect(cfg.baseUrl).toBe('https://api.anthropic.com/v1');
  });

  it('keeps a pathful override and strips trailing slashes', () => {
    const cfg = service.fromProject(
      projectFixture({
        llmType: 'CLOUD',
        cloudProvider: 'openai',
        cloudModel: 'gpt-4o-mini',
        cloudBaseUrl: 'https://proxy.example.com/openai/v1/',
        cloudApiKeyEnc: 'v1.sealed',
      }),
    );
    expect(cfg.baseUrl).toBe('https://proxy.example.com/openai/v1');
  });

  it('falls back to the provider default for an unparseable override', () => {
    const cfg = service.fromProject(
      projectFixture({
        llmType: 'CLOUD',
        cloudProvider: 'openai',
        cloudModel: 'gpt-4o-mini',
        cloudBaseUrl: 'not a url',
        cloudApiKeyEnc: 'v1.sealed',
      }),
    );
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('prefers an explicit cloud base URL override', () => {
    const cfg = service.fromProject(
      projectFixture({
        llmType: 'CLOUD',
        cloudProvider: 'custom',
        cloudModel: 'my-model',
        cloudBaseUrl: 'https://gw.example.com/v1',
        cloudApiKeyEnc: 'v1.sealed',
      }),
    );
    expect(cfg.baseUrl).toBe('https://gw.example.com/v1');
  });

  it('never logs the API key', () => {
    service.fromProject(
      projectFixture({
        llmType: 'CLOUD',
        cloudProvider: 'openai',
        cloudModel: 'gpt-4o-mini',
        cloudApiKeyEnc: 'v1.sealed',
      }),
    );
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('llm=cloud');
    expect(logged).not.toContain('sk-decrypted');
    expect(logged).not.toContain('v1.sealed');
  });

  it('two projects resolve independently', () => {
    const a = service.fromProject(projectFixture({ id: 'a', llmModel: 'qwen3:8b' }));
    const b = service.fromProject(
      projectFixture({
        id: 'b',
        llmType: 'CLOUD',
        cloudProvider: 'groq',
        cloudModel: 'llama-3.3-70b-versatile',
        cloudApiKeyEnc: 'v1.sealed',
      }),
    );
    expect(a.type).toBe('local');
    expect(a.model).toBe('qwen3:8b');
    expect(b.type).toBe('cloud');
    expect(b.baseUrl).toBe('https://api.groq.com/openai/v1');
  });
});
