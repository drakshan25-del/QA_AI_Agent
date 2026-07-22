import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SELF_REGISTER_ROLES, Role } from '../../../common/enums';

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password!: string;

  // Self-registration must never grant a privileged role (admin/qa_lead/
  // supervisor/devops) — those are assigned by an administrator (SEC-001).
  @ApiPropertyOptional({ enum: SELF_REGISTER_ROLES })
  @IsOptional()
  @IsIn(SELF_REGISTER_ROLES as unknown as string[])
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}
