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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembershipService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../errors");
let MembershipService = class MembershipService {
    constructor(projects, members) {
        this.projects = projects;
        this.members = members;
    }
    async getProjectOr404(projectId) {
        const project = await this.projects.findOne({ where: { id: projectId } });
        if (!project)
            throw new errors_1.NotFoundAppException(`Project ${projectId} not found`);
        return project;
    }
    async isMember(projectId, userId) {
        const count = await this.members.count({ where: { projectId, userId } });
        return count > 0;
    }
    async ensureMember(projectId, user) {
        if (user.role === 'admin')
            return;
        const ok = await this.isMember(projectId, user.id);
        if (!ok) {
            throw new errors_1.ForbiddenAppException(`User is not a member of project ${projectId}`);
        }
    }
    async addMember(projectId, userId, projectRole) {
        const existing = await this.members.findOne({
            where: { projectId, userId },
        });
        if (existing)
            return existing;
        const member = this.members.create({ projectId, userId, projectRole });
        return this.members.save(member);
    }
};
exports.MembershipService = MembershipService;
exports.MembershipService = MembershipService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Project)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.ProjectMember)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], MembershipService);
//# sourceMappingURL=membership.service.js.map