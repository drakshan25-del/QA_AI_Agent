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
var RetentionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetentionService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const fs_1 = require("fs");
const path_1 = require("path");
const entities_1 = require("../../entities");
const audit_service_1 = require("../audit/audit.service");
let RetentionService = RetentionService_1 = class RetentionService {
    constructor(jobLogs, executionEvents, audit, config) {
        this.jobLogs = jobLogs;
        this.executionEvents = executionEvents;
        this.audit = audit;
        this.config = config;
        this.logger = new common_1.Logger(RetentionService_1.name);
        this.timer = null;
    }
    get policy() {
        return (this.config.get('retention') ?? {
            jobLogDays: 0,
            executionEventDays: 0,
            evidenceDays: 0,
            sweepIntervalMinutes: 720,
        });
    }
    onModuleInit() {
        const { jobLogDays, executionEventDays, evidenceDays, sweepIntervalMinutes } = this.policy;
        if (!jobLogDays && !executionEventDays && !evidenceDays) {
            this.logger.log('Retention policy: keep everything (all windows = 0).');
            return;
        }
        const intervalMs = Math.max(sweepIntervalMinutes, 5) * 60_000;
        this.timer = setInterval(() => void this.sweep(), intervalMs);
        if (typeof this.timer.unref === 'function')
            this.timer.unref();
        void this.sweep();
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async sweep() {
        const { jobLogDays, executionEventDays, evidenceDays } = this.policy;
        const removed = {
            jobLogs: 0,
            executionEvents: 0,
            evidenceDirs: 0,
        };
        try {
            if (jobLogDays > 0) {
                const res = await this.jobLogs.delete({
                    createdAt: (0, typeorm_2.LessThan)(daysAgo(jobLogDays)),
                });
                removed.jobLogs = res.affected ?? 0;
            }
            if (executionEventDays > 0) {
                const res = await this.executionEvents.delete({
                    createdAt: (0, typeorm_2.LessThan)(daysAgo(executionEventDays)),
                });
                removed.executionEvents = res.affected ?? 0;
            }
            if (evidenceDays > 0) {
                removed.evidenceDirs = await this.sweepEvidence(daysAgo(evidenceDays));
            }
            if (removed.jobLogs || removed.executionEvents || removed.evidenceDirs) {
                await this.audit.record({
                    actor: 'system',
                    actorId: null,
                    action: 'retention.sweep',
                    resourceType: 'system',
                    resourceId: 'retention',
                    projectId: null,
                    metadata: removed,
                });
                this.logger.log(`Retention sweep removed ${JSON.stringify(removed)} expired records`);
            }
        }
        catch (err) {
            this.logger.warn(`retention sweep failed: ${err.message}`);
        }
        return removed;
    }
    async sweepEvidence(cutoff) {
        const artifactsDir = (0, path_1.join)(process.cwd(), '..', 'artifacts');
        let removed = 0;
        try {
            const entries = await fs_1.promises.readdir(artifactsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const full = (0, path_1.join)(artifactsDir, entry.name);
                const stat = await fs_1.promises.stat(full);
                if (stat.mtime < cutoff) {
                    await fs_1.promises.rm(full, { recursive: true, force: true });
                    removed += 1;
                }
            }
        }
        catch {
        }
        return removed;
    }
};
exports.RetentionService = RetentionService;
exports.RetentionService = RetentionService = RetentionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.JobLogEntry)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.ExecutionEvent)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        audit_service_1.AuditService,
        config_1.ConfigService])
], RetentionService);
function daysAgo(days) {
    return new Date(Date.now() - days * 86_400_000);
}
//# sourceMappingURL=retention.service.js.map