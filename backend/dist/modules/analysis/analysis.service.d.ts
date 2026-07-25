import { Repository } from 'typeorm';
import { Analysis, GenerationRun, Project, Requirement } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { MembershipService } from '../../common/access/membership.service';
import { RequirementDerivationService } from '../requirements/requirement-derivation.service';
import { EngineClient } from '../../engine/engine.client';
import { CreateAnalysisJobDto } from './dto/analysis.dto';
export declare class AnalysisService {
    private readonly analyses;
    private readonly requirements;
    private readonly runs;
    private readonly projects;
    private readonly membership;
    private readonly audit;
    private readonly events;
    private readonly jobs;
    private readonly derivation;
    private readonly engine;
    constructor(analyses: Repository<Analysis>, requirements: Repository<Requirement>, runs: Repository<GenerationRun>, projects: Repository<Project>, membership: MembershipService, audit: AuditService, events: EventsService, jobs: JobsService, derivation: RequirementDerivationService, engine: EngineClient);
    createJob(projectId: string, dto: CreateAnalysisJobDto, user: AuthUser, correlationId?: string, idempotencyKey?: string): Promise<{
        jobId: string;
        status: "queued" | "running" | "awaiting_approval" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
        requirements: number;
    }>;
    listByProject(projectId: string, user: AuthUser): Promise<Analysis[]>;
    getOne(id: string, user: AuthUser): Promise<Analysis>;
}
