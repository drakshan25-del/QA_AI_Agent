import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES, Role, Runner } from '../../../common/enums';
import {
  CLOUD_PROVIDER_IDS,
  LLM_TYPES,
  LlmType,
} from '../../../common/llm/providers';

/** Cloud/local LLM configuration fields shared by create + update. */
abstract class LlmConfigFields {
  @ApiPropertyOptional({ enum: LLM_TYPES, default: 'LOCAL' })
  @IsOptional()
  @IsIn(LLM_TYPES as unknown as string[])
  llmType?: LlmType;

  @ApiPropertyOptional({ enum: CLOUD_PROVIDER_IDS })
  @IsOptional()
  @IsIn(CLOUD_PROVIDER_IDS)
  cloudProvider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cloudModel?: string;

  /** Write-only: sealed server-side, never returned by any endpoint. */
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cloudApiKey?: string;

  @ApiPropertyOptional({ description: 'OpenAI-compatible endpoint override' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^$|^https?:\/\//, {
    message: 'cloudBaseUrl must be an http(s) URL',
  })
  cloudBaseUrl?: string;
}

export class CreateProjectDto extends LlmConfigFields {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @ApiPropertyOptional({
    description:
      'API base URL when it differs from baseUrl (host/port/prefix); empty = baseUrl',
  })
  @IsOptional()
  @IsString()
  @Matches(/^$|^https?:\/\//, {
    message: 'apiBaseUrl must be an http(s) URL',
  })
  apiBaseUrl?: string;

  @ApiPropertyOptional({ description: 'CSV allow-list (SEC-003)' })
  @IsOptional()
  @IsString()
  allowedDomains?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  repository?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  llmModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  llmTemperature?: number;

  @ApiPropertyOptional({ enum: ['pytest', 'playwright-test'] })
  @IsOptional()
  @IsIn(['pytest', 'playwright-test'])
  runner?: Runner;

  @ApiPropertyOptional({
    description: 'Zero-pad width for displayed TC IDs, 0 = none (FR-V3-TC-004)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(8)
  tcZeroPad?: number;
}

export class UpdateProjectDto extends LlmConfigFields {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @ApiPropertyOptional({
    description:
      'API base URL when it differs from baseUrl (host/port/prefix); empty = baseUrl',
  })
  @IsOptional()
  @IsString()
  @Matches(/^$|^https?:\/\//, {
    message: 'apiBaseUrl must be an http(s) URL',
  })
  apiBaseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  allowedDomains?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  repository?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ enum: ['active', 'archived'] })
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  llmModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  llmTemperature?: number;

  @ApiPropertyOptional({ enum: ['pytest', 'playwright-test'] })
  @IsOptional()
  @IsIn(['pytest', 'playwright-test'])
  runner?: Runner;

  @ApiPropertyOptional({
    description: 'Zero-pad width for displayed TC IDs, 0 = none (FR-V3-TC-004)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(8)
  tcZeroPad?: number;
}

export class AddMemberDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES as unknown as string[])
  projectRole?: Role;
}
