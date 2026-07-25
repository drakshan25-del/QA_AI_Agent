"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const password_service_1 = require("../../common/crypto/password.service");
const errors_1 = require("../../common/errors");
const audit_service_1 = require("../audit/audit.service");
let AuthService = AuthService_1 = class AuthService {
    constructor(users, passwords, jwt, config, audit) {
        this.users = users;
        this.passwords = passwords;
        this.jwt = jwt;
        this.config = config;
        this.audit = audit;
        this.logger = new common_1.Logger(AuthService_1.name);
    }
    async onModuleInit() {
        const seed = this.config.get('seedAdmin');
        if (!seed.email || !seed.password) {
            this.logger.warn('SEED_ADMIN_EMAIL/PASSWORD not set — skipping admin seed');
            return;
        }
        const existing = await this.users.findOne({ where: { email: seed.email } });
        if (existing)
            return;
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
    toPublic(u) {
        return {
            id: u.id,
            email: u.email,
            role: u.role,
            name: u.name,
            createdAt: u.createdAt,
        };
    }
    async register(dto, correlationId) {
        const email = dto.email.toLowerCase().trim();
        const existing = await this.users.findOne({ where: { email } });
        if (existing) {
            throw new errors_1.ConflictAppException('A user with this email already exists', 'email_taken');
        }
        const user = this.users.create({
            email,
            passwordHash: await this.passwords.hash(dto.password),
            role: dto.role || 'qa_engineer',
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
    async findWithHash(email) {
        return this.users
            .createQueryBuilder('u')
            .addSelect('u.passwordHash')
            .where('u.email = :email', { email })
            .getOne();
    }
    async validateUser(email, password) {
        const user = await this.findWithHash(email.toLowerCase().trim());
        if (!user || !user.isActive) {
            throw new errors_1.UnauthorizedAppException('Invalid credentials');
        }
        const ok = await this.passwords.compare(password, user.passwordHash);
        if (!ok)
            throw new errors_1.UnauthorizedAppException('Invalid credentials');
        return user;
    }
    signAccess(user) {
        const jwt = this.config.get('jwt');
        return this.jwt.sign({ sub: user.id, email: user.email, role: user.role, type: 'access' }, { secret: jwt.accessSecret, expiresIn: jwt.accessTtl });
    }
    signRefresh(user) {
        const jwt = this.config.get('jwt');
        return this.jwt.sign({ sub: user.id, email: user.email, type: 'refresh' }, { secret: jwt.refreshSecret, expiresIn: jwt.refreshTtl });
    }
    async login(email, password, correlationId) {
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
    async refresh(refreshToken) {
        const jwt = this.config.get('jwt');
        let payload;
        try {
            payload = this.jwt.verify(refreshToken, { secret: jwt.refreshSecret });
        }
        catch {
            throw new errors_1.UnauthorizedAppException('Invalid or expired refresh token');
        }
        if (payload.type !== 'refresh') {
            throw new errors_1.UnauthorizedAppException('Not a refresh token');
        }
        const user = await this.users.findOne({ where: { id: payload.sub } });
        if (!user || !user.isActive) {
            throw new errors_1.UnauthorizedAppException('User no longer active');
        }
        return { accessToken: this.signAccess(user) };
    }
    async me(userId) {
        const user = await this.users.findOne({ where: { id: userId } });
        if (!user)
            throw new errors_1.UnauthorizedAppException('User not found');
        return this.toPublic(user);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.User)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        password_service_1.PasswordService,
        jwt_1.JwtService,
        config_1.ConfigService,
        audit_service_1.AuditService])
], AuthService);
//# sourceMappingURL=auth.service.js.map