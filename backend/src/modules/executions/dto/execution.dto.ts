import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RunScope } from '../../../common/enums';

/**
 * Requested run settings (FR-V3-EXE-011). Validated here for shape and again
 * in the service against the administrator-defined limits; the effective
 * values are persisted with the run.
 */
export class ExecutionSettingsDto {
  @ApiPropertyOptional({ default: 900 })
  @IsOptional()
  @IsInt()
  @Min(1)
  timeoutSeconds?: number;

  @ApiPropertyOptional({ default: 0, description: 'Reruns per failed test' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  retries?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(16)
  workers?: number;

  @ApiPropertyOptional({ default: 0, description: 'Playwright slow-motion in ms' })
  @IsOptional()
  @IsInt()
  @Min(0)
  slowMoMs?: number;

  @ApiPropertyOptional({
    default: 'on-failure',
    enum: ['on-failure', 'every-test', 'off'],
  })
  @IsOptional()
  @IsIn(['on-failure', 'every-test', 'off'])
  screenshotMode?: 'on-failure' | 'every-test' | 'off';

  @ApiPropertyOptional({ default: false, description: 'Record video evidence' })
  @IsOptional()
  @IsBoolean()
  video?: boolean;
}

export class CreateExecutionDto {
  @ApiProperty()
  @IsString()
  projectId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  automationIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  testPaths?: string[];

  /** Chromium/Chrome, Firefox or Safari-compatible WebKit (FR-V3-EXE-003). */
  @ApiPropertyOptional({ default: 'chromium', enum: ['chromium', 'firefox', 'webkit'] })
  @IsOptional()
  @IsIn(['chromium', 'firefox', 'webkit'])
  browser?: string;

  /** Headed opens a visible browser on the execution host (FR-V3-EXE-002/004). */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  headed?: boolean;

  @ApiPropertyOptional({ default: 'local' })
  @IsOptional()
  @IsString()
  environment?: string;

  /** Run Selected / Run Failed / Run All (FR-V3-EXE-007). */
  @ApiPropertyOptional({ default: 'selected', enum: ['selected', 'failed', 'all'] })
  @IsOptional()
  @IsIn(['selected', 'failed', 'all'])
  runScope?: RunScope;

  @ApiPropertyOptional({ type: ExecutionSettingsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ExecutionSettingsDto)
  settings?: ExecutionSettingsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  markers?: string;
}
