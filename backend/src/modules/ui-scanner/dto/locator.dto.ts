import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Approve or reject the recommended locator for one scanned element. */
export class ApproveLocatorDto {
  @ApiPropertyOptional({
    description: 'Candidate to approve; defaults to the recommended one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  candidateId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  /** Optional human-facing name for the element in generated tests. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  elementName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

/**
 * Replace the locator of one scanned element with a hand-edited one.
 *
 * The edit is structural, not textual: the client sends `locatorData` and the
 * backend renders the Playwright code from it, so no stored string ever has to
 * be turned back into behaviour (SEC-005).
 */
export class UpdateLocatorDto {
  @ApiProperty({ type: Object })
  @IsObject()
  locatorData!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  elementName?: string;
}

/** Bulk-approve every element whose recommended locator clears the bar. */
export class ApproveHighConfidenceDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.9 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfidence?: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Only approve locators that matched exactly one element.',
  })
  @IsOptional()
  @IsBoolean()
  uniqueOnly?: boolean;
}

/** Persist the approved locators of a scan into the project locator library. */
export class SaveLocatorsDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Scanned element ids; omit to save every approved element.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  elementIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageName?: string;
}

/** Filters for the project locator library. */
export class ListLocatorsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pageUrlPattern?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  elementName?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  approvedOnly?: 'true' | 'false';

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  activeOnly?: 'true' | 'false';
}

/**
 * Re-validate a stored locator against the live page (§11, §26).
 *
 * Credentials, when the page needs them, are supplied per request exactly as
 * they are for a scan — they are never read from storage.
 */
export class ValidateLocatorDto {
  @ApiPropertyOptional({
    description: 'Page to validate against; defaults to the scanned page URL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  candidateId?: string;

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
}
