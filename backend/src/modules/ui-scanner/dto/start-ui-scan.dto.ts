import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BROWSERS, Browser } from '../../../common/enums';

/** One deterministic interaction performed before the scan starts (§15). */
export class PreScanActionDto {
  @ApiProperty({
    enum: ['click', 'fill', 'selectOption', 'waitFor', 'waitForUrl', 'press'],
  })
  @IsIn(['click', 'fill', 'selectOption', 'waitFor', 'waitForUrl', 'press'])
  action!: 'click' | 'fill' | 'selectOption' | 'waitFor' | 'waitForUrl' | 'press';

  /** Machine-readable locator; never a code string (SEC-005). */
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  locator?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  value?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  key?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;
}

/**
 * Start a UI scan (FR-UIS-002).
 *
 * `username` and `password` are used for one sign-in against the target
 * application and are never persisted, logged or echoed back (§16). They are
 * deliberately part of the request body rather than the project record so a
 * scan never depends on stored credentials.
 */
export class StartUiScanDto {
  @ApiProperty({ example: 'https://example.com/dashboard' })
  @IsString()
  @MaxLength(2000)
  url!: string;

  @ApiPropertyOptional({ enum: BROWSERS })
  @IsOptional()
  @IsIn(BROWSERS as unknown as string[])
  browser?: Browser;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  headless?: boolean;

  @ApiPropertyOptional({ minimum: 5000, maximum: 300000, default: 45000 })
  @IsOptional()
  @IsInt()
  @Min(5_000)
  @Max(300_000)
  timeoutMs?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 250 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  maxElements?: number;

  /**
   * Pages to scan by following in-app links (FR-UIS-015). 1 scans only the
   * target page. The crawl never follows sign-out, destructive or off-site
   * links — see `engine/uiscanner/crawl.py`.
   */
  @ApiPropertyOptional({ minimum: 1, maximum: 25, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25)
  maxPages?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeHidden?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  captureScreenshot?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  captureAccessibility?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  scanFrames?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  useLlmFallback?: boolean;

  /** Page to sign in on when it differs from the page being scanned. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  loginUrl?: string;

  /** Single-use credential for the target application — never stored (§16). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  username?: string;

  /** Single-use credential for the target application — never stored (§16). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  /**
   * Id of an approved storage state belonging to this project. A filesystem
   * path is never accepted from the browser (§16 path-traversal).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  storageStateId?: string;

  @ApiPropertyOptional({ type: [PreScanActionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreScanActionDto)
  preScanActions?: PreScanActionDto[];
}
