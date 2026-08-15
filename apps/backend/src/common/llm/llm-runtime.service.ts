import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../entities';
import { NotFoundAppException } from '../errors';
import { SecretBoxService } from '../crypto/secret-box.service';
import { cloudProviderById } from './providers';

/**
 * The LLM configuration a generation call sends to the engine. `apiKey` is
 * decrypted just-in-time for the engine-internal request (token-protected,
 * server-to-server) and never logged, audited or returned to a browser.
 */
export interface EngineLlmConfig {
  type: 'local' | 'cloud';
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
}

/**
 * Resolves the per-project LLM runtime for every AI workflow (analysis, test
 * plans, test cases, automation, classification, reports). No workflow may
 * fall back to a global default when the project has a configuration — this
 * service is the single place that decides what the engine runs on.
 */
@Injectable()
export class LlmRuntimeService {
  private readonly logger = new Logger(LlmRuntimeService.name);

  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly secretBox: SecretBoxService,
  ) {}

  async engineLlmFor(projectId: string): Promise<EngineLlmConfig> {
    const project = await this.projects
      .createQueryBuilder('p')
      .addSelect('p.cloudApiKeyEnc')
      .where('p.id = :id', { id: projectId })
      .getOne();
    if (!project) {
      throw new NotFoundAppException(`Project ${projectId} not found`);
    }
    return this.fromProject(project);
  }

  /**
   * A base-URL override pointing at a known provider's bare host (no path)
   * is always a mistake — the OpenAI-compatible API lives under a path
   * (e.g. `/v1`), and the SDK would build `https://host/chat/completions`
   * and 404. Re-anchor such overrides onto the provider's API path.
   */
  private normalizeBaseUrl(
    override: string,
    providerDefault: string | undefined,
  ): string {
    const trimmed = override.trim().replace(/\/+$/, '');
    if (!trimmed) return providerDefault ?? '';
    if (!providerDefault) return trimmed; // custom provider: taken as typed
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname === '' || parsed.pathname === '/') {
        return `${parsed.origin}${new URL(providerDefault).pathname}`;
      }
      return trimmed;
    } catch {
      return providerDefault;
    }
  }

  /** Pure mapping, exposed for unit tests. Never logs secrets. */
  fromProject(project: Project): EngineLlmConfig {
    if (project.llmType === 'CLOUD') {
      const provider = cloudProviderById(project.cloudProvider);
      const baseUrl = this.normalizeBaseUrl(
        project.cloudBaseUrl,
        provider?.defaultBaseUrl || undefined,
      );
      const apiKey = project.cloudApiKeyEnc
        ? this.secretBox.open(project.cloudApiKeyEnc)
        : '';
      // Safe informational log (SEC-007): identifies the routing decision,
      // never the credential.
      this.logger.log(
        `project=${project.id} llm=cloud provider=${project.cloudProvider} model=${project.cloudModel}`,
      );
      return {
        type: 'cloud',
        provider: project.cloudProvider,
        model: project.cloudModel,
        apiKey,
        baseUrl: baseUrl || undefined,
        temperature: project.llmTemperature,
      };
    }
    this.logger.log(
      `project=${project.id} llm=local model=${project.llmModel || '(engine default)'}`,
    );
    return {
      type: 'local',
      model: project.llmModel || undefined,
      temperature: project.llmTemperature,
    };
  }
}
