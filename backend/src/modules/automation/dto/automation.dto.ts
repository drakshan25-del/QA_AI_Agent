import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
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
}
