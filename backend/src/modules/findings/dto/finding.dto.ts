import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FindingClassification } from '../../../common/enums';

const CLASSES = [
  'app_defect',
  'test_defect',
  'environment',
  'data',
  'inconclusive',
];

export class OverrideFindingDto {
  @ApiProperty({ enum: CLASSES })
  @IsIn(CLASSES)
  classification!: FindingClassification;

  @ApiProperty()
  @IsString()
  reason!: string;
}

export class ClassifyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  context?: string;
}
