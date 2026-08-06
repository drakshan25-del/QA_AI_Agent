import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateTestPlanDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requirementIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;
}

export class UpdateTestPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Partial TestPlanOutput sections to merge' })
  @IsOptional()
  @IsObject()
  sections?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Human summary recorded on the new revision (FR-V3-TP-002)',
  })
  @IsOptional()
  @IsString()
  changeSummary?: string;
}
