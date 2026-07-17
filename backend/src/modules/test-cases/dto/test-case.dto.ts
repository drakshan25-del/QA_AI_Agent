import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateTestCasesDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Omit to generate for all project requirements (incl. document-derived).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requirementIds?: string[];

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minCases?: number;
}

export class UpdateTestCaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  objective?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  preconditions?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  steps?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  expectedResults?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  testData?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  automationSuitability?: string;
}
