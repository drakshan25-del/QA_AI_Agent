import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExecutionDto {
  @ApiProperty()
  @IsString()
  projectId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  automationIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  testPaths?: string[];

  @ApiPropertyOptional({ default: 'chromium' })
  @IsOptional()
  @IsIn(['chromium', 'firefox', 'webkit'])
  browser?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  headed?: boolean;

  @ApiPropertyOptional({ default: 'local' })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  markers?: string;
}
