import { Global, Module } from '@nestjs/common';
import { SecretBoxService } from '../crypto/secret-box.service';
import { LlmRuntimeService } from './llm-runtime.service';

/**
 * Global LLM configuration infrastructure: secret sealing for cloud API keys
 * and per-project runtime resolution used by every generation workflow.
 * (The Project repository comes from the global AccessModule TypeORM feature.)
 */
@Global()
@Module({
  providers: [SecretBoxService, LlmRuntimeService],
  exports: [SecretBoxService, LlmRuntimeService],
})
export class LlmModule {}
