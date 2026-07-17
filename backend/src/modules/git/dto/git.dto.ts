import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GitCommitDto {
  @ApiProperty({ type: [String], description: 'Artifact paths to commit' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  paths!: string[];

  @ApiProperty()
  @IsString()
  message!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchSuffix?: string;

  @ApiPropertyOptional({ description: 'Client assertion; server re-verifies approval' })
  @IsOptional()
  @IsBoolean()
  approved?: boolean;
}
