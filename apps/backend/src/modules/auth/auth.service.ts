import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities';
import { PasswordService } from '../../common/crypto/password.service';
import { AppConfig } from '../../config/configuration';
import { Role } from '../../common/enums';
import {
  ConflictAppException,
  UnauthorizedAppException,
} from '../../common/errors';
import { RegisterDto } from './dto/auth.dto';
import { AuditService } from '../audit/audit.service';

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  name: string;
  isActive: boolean;
  createdAt: Date;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Seed the admin from env on first boot (V2_CONTRACT §1). */
  async onModuleInit(): Promise<void> {
    await this.seedAdmin();
    await this.promoteSuperowner();
  }

  private async seedAdmin(): Promise<void> {
    const seed = this.config.get<AppConfig['seedAdmin']>('seedAdmin')!;
    if (!seed.email || !seed.password) {
      this.logger.warn('SEED_ADMIN_EMAIL/PASSWORD not set — skipping admin seed');
      return;
    }
    const existing = await this.users.findOne({ where: { email: seed.email } });
    if (existing) return;
    const admin = this.users.create({
      email: seed.email,
      passwordHash: await this.passwords.hash(seed.password),
      role: 'admin',
      name: 'Seed Admin',
      isActive: true,
    });
    await this.users.save(admin);
    this.logger.log(`Seeded admin user ${seed.email}`);
    await this.audit.record({
      actor: 'system',
      action: 'user.seed',
      resourceType: 'user',
      resourceId: admin.id,
      metadata: { email: seed.email, role: 'admin' },
    });
  }

  private superownerEmail(): string {
    return this.config.get<AppConfig['superowner']>('superowner')!.email;
  }

  /**
   * The SUPEROWNER_EMAIL account is the platform owner: ensure it always
   * carries the `superowner` role (it may predate the role, e.g. as admin).
   */
  private async promoteSuperowner(): Promise<void> {
    const email = this.superownerEmail();
    if (!email) return;
    const owner = await this.users.findOne({ where: { email } });
    if (!owner || owner.role === 'superowner') return;
    const previousRole = owner.role;
    owner.role = 'superowner';
    await this.users.save(owner);
    this.logger.log(`Promoted ${email} to superowner`);
    await this.audit.record({
      actor: 'system',
      action: 'user.promote_superowner',
      resourceType: 'user',
      resourceId: owner.id,
      metadata: { email, previousRole },
    });
  }

  toPublic(u: User): PublicUser {
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      name: u.name,
      isActive: u.isActive,
      createdAt: u.createdAt,
    };
  }

  async register(
    dto: RegisterDto,
    correlationId?: string,
  ): Promise<PublicUser> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictAppException(
        'A user with this email already exists',
        'email_taken',
      );
    }
    // The configured owner email always signs up as superowner; everyone
    // else gets the (validated, non-privileged) requested role.
    const role: Role =
      email === this.superownerEmail()
        ? 'superowner'
        : dto.role || 'qa_engineer';
    const user = this.users.create({
      email,
      passwordHash: await this.passwords.hash(dto.password),
      role,
      name: dto.name || '',
      isActive: true,
    });
    const saved = await this.users.save(user);
    await this.audit.record({
      actor: email,
      actorId: saved.id,
      action: 'user.register',
      resourceType: 'user',
      resourceId: saved.id,
      correlationId,
      metadata: { role: saved.role },
    });
    return this.toPublic(saved);
  }

  private async findWithHash(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.findWithHash(email.toLowerCase().trim());
    if (!user) {
      throw new UnauthorizedAppException('Invalid credentials');
    }
    const ok = await this.passwords.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedAppException('Invalid credentials');
    // Only reveal the disabled state to callers holding valid credentials.
    if (!user.isActive) {
      throw new UnauthorizedAppException(
        'This account has been disabled. Contact the administrator.',
        { reason: 'account_disabled' },
      );
    }
    return user;
  }

  signAccess(user: User): string {
    const jwt = this.config.get<AppConfig['jwt']>('jwt')!;
    return this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role, type: 'access' },
      { secret: jwt.accessSecret, expiresIn: jwt.accessTtl },
    );
  }

  signRefresh(user: User): string {
    const jwt = this.config.get<AppConfig['jwt']>('jwt')!;
    return this.jwt.sign(
      { sub: user.id, email: user.email, type: 'refresh' },
      { secret: jwt.refreshSecret, expiresIn: jwt.refreshTtl },
    );
  }

  async login(
    email: string,
    password: string,
    correlationId?: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const user = await this.validateUser(email, password);
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      correlationId,
    });
    return {
      accessToken: this.signAccess(user),
      refreshToken: this.signRefresh(user),
      user: this.toPublic(user),
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    const jwt = this.config.get<AppConfig['jwt']>('jwt')!;
    let payload: { sub: string; type?: string };
    try {
      payload = this.jwt.verify(refreshToken, { secret: jwt.refreshSecret });
    } catch {
      throw new UnauthorizedAppException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedAppException('Not a refresh token');
    }
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedAppException('User no longer active');
    }
    return { accessToken: this.signAccess(user) };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedAppException('User not found');
    return this.toPublic(user);
  }
}
