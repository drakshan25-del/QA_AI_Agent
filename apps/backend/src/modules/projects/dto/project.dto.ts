import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES, Role, Runner } from '../../../common/enums';

export class CreateProjectDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @ApiPropertyOptional({ description: 'CSV allow-list (SEC-003)' })
  @IsOptional()
  @IsString()
  allowedDomains?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  repository?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  llmModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  llmTemperature?: number;

  @ApiPropertyOptional({ enum: ['pytest', 'playwright-test'] })
  @IsOptional()
  @IsIn(['pytest', 'playwright-test'])
  runner?: Runner;

  @ApiPropertyOptional({
    description: 'Zero-pad width for displayed TC IDs, 0 = none (FR-V3-TC-004)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(8)
  tcZeroPad?: number;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  allowedDomains?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  repository?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ enum: ['active', 'archived'] })
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  llmModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  llmTemperature?: number;

  @ApiPropertyOptional({ enum: ['pytest', 'playwright-test'] })
  @IsOptional()
  @IsIn(['pytest', 'playwright-test'])
  runner?: Runner;

  @ApiPropertyOptional({
    description: 'Zero-pad width for displayed TC IDs, 0 = none (FR-V3-TC-004)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(8)
  tcZeroPad?: number;
}

export class AddMemberDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES as unknown as string[])
  projectRole?: Role;
}
