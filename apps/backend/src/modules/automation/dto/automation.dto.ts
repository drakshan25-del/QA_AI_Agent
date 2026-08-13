import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateAutomationDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  testCaseIds!: string[];

  @ApiPropertyOptional({
    description: 'Draft preview bypasses the approved-only gate (FR-TC-009)',
  })
  @IsOptional()
  @IsBoolean()
  draftPreview?: boolean;

  /** Browser UI tests (default) or HTTP API tests. */
  @ApiPropertyOptional({ default: 'ui', enum: ['ui', 'api'] })
  @IsOptional()
  @IsIn(['ui', 'api'])
  testType?: 'ui' | 'api';

  @ApiPropertyOptional({
    description: 'Tag the generated files as part of the regression suite',
  })
  @IsOptional()
  @IsBoolean()
  regressionSuite?: boolean;
}

/** In-place edit of a generated automation script (editable code editor). */
export class UpdateAutomationDto {
  @ApiProperty({ description: 'The full edited script content.' })
  @IsString()
  // 1 MiB ceiling: generated test files are small; this bounds a hostile body.
  @MaxLength(1_048_576, { message: 'content exceeds the 1 MiB limit' })
  content!: string;
}
