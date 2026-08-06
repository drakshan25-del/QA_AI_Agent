import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DispatchWorkflowDto {
  @ApiProperty()
  @IsString()
  projectId!: string;

  @ApiPropertyOptional({ description: 'Client assertion; server re-verifies approval' })
  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @ApiPropertyOptional({ description: 'Workflow file name (default qa.yml)' })
  @IsOptional()
  @IsString()
  workflow?: string;

  @ApiPropertyOptional({ description: 'Git ref (default main)' })
  @IsOptional()
  @IsString()
  ref?: string;
}
