import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthService, PublicUser } from '../auth/auth.service';

/** Account administration, reserved for the superowner (accounts.manage). */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<PublicUser[]> {
    const all = await this.users.find({ order: { createdAt: 'ASC' } });
    return all.map((u) => this.auth.toPublic(u));
  }

  async setActive(
    id: string,
    isActive: boolean,
    actor: AuthUser,
    correlationId?: string,
  ): Promise<PublicUser> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundAppException('User not found');
    if (user.id === actor.id) {
      throw new ForbiddenAppException(
        'You cannot change the status of your own account',
      );
    }
    if (user.role === 'superowner') {
      throw new ForbiddenAppException(
        'The superowner account cannot be disabled',
      );
    }
    if (user.isActive !== isActive) {
      user.isActive = isActive;
      await this.users.save(user);
      await this.audit.record({
        actor: actor.email,
        actorId: actor.id,
        action: isActive ? 'user.enable' : 'user.disable',
        resourceType: 'user',
        resourceId: user.id,
        correlationId,
        metadata: { email: user.email, role: user.role },
      });
    }
    return this.auth.toPublic(user);
  }
}
