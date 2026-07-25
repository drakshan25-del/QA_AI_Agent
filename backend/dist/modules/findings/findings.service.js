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
exports.FindingsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../../entities");
const errors_1 = require("../../common/errors");
const audit_service_1 = require("../audit/audit.service");
const membership_service_1 = require("../../common/access/membership.service");
const engine_client_1 = require("../../engine/engine.client");
let FindingsService = class FindingsService {
    constructor(findings, results, runs, membership, audit, engine) {
        this.findings = findings;
        this.results = results;
        this.runs = runs;
        this.membership = membership;
        this.audit = audit;
        this.engine = engine;
    }
    async projectOfResult(result) {
        const run = await this.runs.findOne({
            where: { id: result.executionRunId },
        });
        if (!run) {
            throw new errors_1.NotFoundAppException(`Execution ${result.executionRunId} not found`);
        }
        return run;
    }
    async classify(resultId, context, user, correlationId) {
        const result = await this.results.findOne({ where: { id: resultId } });
        if (!result)
            throw new errors_1.NotFoundAppException(`Result ${resultId} not found`);
        const run = await this.projectOfResult(result);
        await this.membership.ensureMember(run.projectId, user);
        const output = await this.engine.classify({
            test: {
                node_id: result.nodeId,
                outcome: result.outcome,
                error_message: result.errorMessage,
            },
            context: { note: context || '', metrics: run.metrics || {} },
        }, correlationId);
        const finding = await this.findings.save(this.findings.create({
            projectId: run.projectId,
            executionRunId: run.id,
            testResultId: result.id,
            classification: output.classification || 'inconclusive',
            confidence: output.confidence ?? 0.5,
            rationale: output.rationale || '',
            severity: output.severity || 'medium',
            overridden: false,
            createdBy: user.id,
        }));
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'finding.classify',
            resourceType: 'finding',
            resourceId: finding.id,
            projectId: run.projectId,
            correlationId,
            metadata: { classification: finding.classification },
        });
        return finding;
    }
    async getOne(id, user) {
        const finding = await this.findings.findOne({ where: { id } });
        if (!finding)
            throw new errors_1.NotFoundAppException(`Finding ${id} not found`);
        await this.membership.ensureMember(finding.projectId, user);
        return finding;
    }
    async override(id, classification, reason, user, correlationId) {
        const finding = await this.getOne(id, user);
        finding.classification = classification;
        finding.overridden = true;
        finding.overrideReason = reason;
        const saved = await this.findings.save(finding);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'finding.override',
            resourceType: 'finding',
            resourceId: id,
            projectId: finding.projectId,
            correlationId,
            metadata: { classification, reason },
        });
        return saved;
    }
    async defectDraft(id, user, correlationId) {
        const finding = await this.getOne(id, user);
        const result = finding.testResultId
            ? await this.results.findOne({ where: { id: finding.testResultId } })
            : null;
        const run = await this.runs.findOne({
            where: { id: finding.executionRunId ?? '' },
        });
        const draft = {
            title: `[${finding.severity}] ${result?.nodeId || 'Test failure'} (${finding.classification})`,
            description: finding.rationale || 'Automated failure analysis.',
            environment: run?.environment || '',
            severity: finding.severity,
            priority: finding.severity === 'critical' ? 'high' : 'medium',
            preconditions: [],
            steps_to_reproduce: [
                `Run ${result?.nodeId || 'the failing test'} on ${run?.browser || 'chromium'}`,
            ],
            expected_result: 'Test passes.',
            actual_result: result?.errorMessage || `outcome=${result?.outcome}`,
            evidence_refs: result?.evidence ? Object.values(result.evidence) : [],
            classification: finding.classification,
            confidence: finding.confidence,
        };
        finding.defectDraft = draft;
        await this.findings.save(finding);
        await this.audit.record({
            actor: user.email,
            actorId: user.id,
            action: 'finding.defect_draft',
            resourceType: 'finding',
            resourceId: id,
            projectId: finding.projectId,
            correlationId,
        });
        return draft;
    }
};
exports.FindingsService = FindingsService;
exports.FindingsService = FindingsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Finding)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.TestResult)),
    __param(2, (0, typeorm_1.InjectRepository)(entities_1.ExecutionRun)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        membership_service_1.MembershipService,
        audit_service_1.AuditService,
        engine_client_1.EngineClient])
], FindingsService);
//# sourceMappingURL=findings.service.js.map