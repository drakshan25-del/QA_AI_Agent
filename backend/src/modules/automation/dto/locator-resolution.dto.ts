import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Credentials for re-validating locators on a page that needs a session
 * (FR-UIS-025 §5.2).
 *
 * Request-scoped exactly like a scan's: forwarded to the engine for one
 * browser session, never persisted, never logged, never sent to a model (§16).
 */
export class ResolutionAuthDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  loginUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  /** Id of an approved storage state; never a filesystem path (§16). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  storageStateId?: string;
}

/** Knobs shared by the resolve endpoints. */
export class ResolutionOptionsDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Re-open the page to re-validate stale or uncertain locators.',
  })
  @IsOptional()
  @IsBoolean()
  revalidate?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Run a bounded single-page rescan for steps nothing matched.',
  })
  @IsOptional()
  @IsBoolean()
  allowTargetedRescan?: boolean;

  @ApiPropertyOptional({
    default: true,
    description:
      'Let the model match leftover steps to already-scanned elements. It can ' +
      'never propose a selector — only choose from the scanned set.',
  })
  @IsOptional()
  @IsBoolean()
  allowLlmMatching?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minMatchConfidence?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minLocatorConfidence?: number;

  @ApiPropertyOptional({ type: ResolutionAuthDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResolutionAuthDto)
  auth?: ResolutionAuthDto;
}

/** One step of an ad-hoc resolution request (§16 batch example). */
export class ResolveStepDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  testStepId!: string;

  @ApiPropertyOptional({ description: 'fill | click | check | select | assert …' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  action?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  sequence?: number;
}

/** `POST /projects/:projectId/locators/resolve` — one test case's steps. */
export class ResolveLocatorsDto extends ResolutionOptionsDto {
  @ApiPropertyOptional({ description: 'Existing approved test case to resolve.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  testCaseId?: string;

  @ApiPropertyOptional({ description: 'Page the steps act on, when known.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageName?: string;

  @ApiPropertyOptional({ type: [ResolveStepDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ResolveStepDto)
  steps?: ResolveStepDto[];
}

/** `POST /projects/:projectId/locators/resolve-batch` — several test cases. */
export class ResolveLocatorsBatchDto extends ResolutionOptionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  testCaseIds!: string[];
}

/** `POST /projects/:projectId/locators/revalidate`. */
export class RevalidateLocatorsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  locatorIds!: string[];

  @ApiPropertyOptional({ type: ResolutionAuthDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResolutionAuthDto)
  auth?: ResolutionAuthDto;
}
