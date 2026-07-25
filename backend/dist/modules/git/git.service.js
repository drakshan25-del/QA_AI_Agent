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
var GitService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const audit_service_1 = require("../audit/audit.service");
const membership_service_1 = require("../../common/access/membership.service");
let GitService = GitService_1 = class GitService {
    constructor(projects, artifacts, membership, audit, config) {
        this.projects = projects;
        this.artifacts = artifacts;
        this.membership = membership;
        this.audit = audit;
        this.config = config;
        this.logger = new common_1.Logger(GitService_1.name);
    }
    async commit(projectId, dto, user, correlationId) {
        await this.membership.ensureMember(projectId, user);
        const project = await this.projects.findOne({ where: { id: projectId } });
        if (!project)
            throw new errors_1.NotFoundAppException(`Project ${projectId} not found`);
        const arts = await this.artifacts.find({
            where: { projectId, path: (0, typeorm_2.In)(dto.paths) },
        });
        if (!arts.length) {
            throw new errors_1.NotFoundAppException('No matching automation artifacts found for the given paths');
        }
        const blocked = arts.filter((a) => a.status !== 'active' ||
            a.approvalStatus !== 'approved' ||
            a.validationStatus !== 'passed');
        if (blocked.length) {
            await this.audit.record({
                actor: user.email,
                actorId: user.id,
                action: 'git.commit',
                resourceType: 'project',
                resourceId: projectId,
                projectId,
                result: 'denied',
                correlationId,
                metadata: { reason: 'unapproved_artifacts', ids: blocked.map((a) => a.id) },
            });
            throw new errors_1.ConflictAppException(`Cannot commit: ${blocked.length} artifact(s) are not approved+validated.`, 'approval_required', { blocked: blocked.map((a) => a.id) });
        }
        const branch = `qa/${(dto.branchSuffix || 'automation').replace(/[^\w.\-/]/g, '-')}`;
        const result = await this.writeAndCommit(projectId, branch, dto.message, arts);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'git.commit',
            resourceType: 'project',
            resourceId: projectId,
            projectId,
            correlationId,
            metadata: { branch, paths: dto.paths, sha: result.sha, mode: result.mode },
        });
        return result;
    }
    async writeAndCommit(projectId, branch, message, arts) {
        const uploadDir = this.config.get('uploadDir');
        const workspace = (0, path_1.join)(uploadDir, 'git', projectId);
        await fs_1.promises.mkdir(workspace, { recursive: true });
        const workspaceRoot = (0, path_1.resolve)(workspace);
        for (const a of arts) {
            const filePath = (0, path_1.resolve)(workspaceRoot, a.path);
            if (filePath !== workspaceRoot && !filePath.startsWith(workspaceRoot + path_1.sep)) {
                throw new errors_1.ValidationFailedException(`Artifact path '${a.path}' escapes the project git workspace`, { artifactId: a.id });
            }
            await fs_1.promises.mkdir((0, path_1.dirname)(filePath), { recursive: true });
            await fs_1.promises.writeFile(filePath, a.content, 'utf8');
        }
        try {
            const git = (args) => (0, child_process_1.execFileSync)('git', args, { cwd: workspace, stdio: 'pipe' })
                .toString()
                .trim();
            if (!(await this.exists((0, path_1.join)(workspace, '.git')))) {
                git(['init', '-q']);
                git(['config', 'user.email', 'qa-agent@example.com']);
                git(['config', 'user.name', 'QA Agent']);
            }
            try {
                git(['checkout', '-q', '-B', branch]);
            }
            catch {
            }
            git(['add', '-A']);
            git(['commit', '-q', '-m', message, '--allow-empty']);
            const sha = git(['rev-parse', 'HEAD']);
            return {
                branch,
                sha,
                committed: arts.map((a) => a.path),
                mode: 'local-workspace',
            };
        }
        catch (err) {
            this.logger.warn(`git commit fell back to staged mode: ${err.message}`);
            return {
                branch,
                sha: '',
                committed: arts.map((a) => a.path),
                mode: 'staged-no-git',
            };
        }
    }
    async exists(path) {
        try {
            await fs_1.promises.access(path);
            return true;
        }
        catch {
            return false;
        }
    }
};
exports.GitService = GitService;
exports.GitService = GitService = GitService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Project)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.GeneratedArtifact)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService,
        config_1.ConfigService])
], GitService);
//# sourceMappingURL=git.service.js.map