import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserStatusDto {
  @ApiProperty({ description: 'false disables the account (blocks sign-in)' })
  @IsBoolean()
  isActive!: boolean;
}
