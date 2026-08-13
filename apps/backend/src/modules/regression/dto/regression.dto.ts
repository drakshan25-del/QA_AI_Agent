import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompareRegressionDto {
  @ApiProperty({ description: 'Execution run to compare against (the baseline)' })
  @IsString()
  baselineRunId!: string;

  @ApiProperty({ description: 'Execution run under evaluation (the candidate)' })
  @IsString()
  candidateRunId!: string;
}
