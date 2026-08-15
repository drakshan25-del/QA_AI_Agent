import { Body, Controller, Get, HttpCode, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { RequirePermission } from '../../common/access/permissions';

/** Account list + enable/disable — superowner only (accounts.manage). */
@ApiTags('users')
@ApiBearerAuth()
@RequirePermission('accounts.manage')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list() {
    return this.usersService.list();
  }

  @Patch(':id/status')
  @HttpCode(200)
  async setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.usersService.setActive(id, dto.isActive, user, correlationId);
  }
}
