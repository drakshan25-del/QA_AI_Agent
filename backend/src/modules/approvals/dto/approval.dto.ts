import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalDecision } from '../../../common/enums';

const DECISIONS = ['approved', 'rejected', 'regenerate'];

export class ApprovalDto {
  @ApiProperty({ enum: DECISIONS })
  @IsIn(DECISIONS)
  decision!: ApprovalDecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class BulkApprovalDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];

  @ApiProperty({ enum: DECISIONS })
  @IsIn(DECISIONS)
  decision!: ApprovalDecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
