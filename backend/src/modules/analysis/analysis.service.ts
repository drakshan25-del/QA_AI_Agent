import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Analysis, GenerationRun, Project, Requirement } from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors';
import { contentHash } from '../../common/hash';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import { CreateAnalysisJobDto } from './dto/analysis.dto';

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(Analysis) private readonly analyses: Repository<Analysis>,
    @InjectRepository(Requirement)
    private readonly requirements: Repository<Requirement>,
    @InjectRepository(GenerationRun)
    private readonly runs: Repository<GenerationRun>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly jobs: JobsService,
    private readonly engine: EngineClient,
  ) {}

  async createJob(
    projectId: string,
    dto: CreateAnalysisJobDto,
    user: AuthUser,
    correlationId?: string,
    idempotencyKey?: string,
  ) {
    await this.membership.ensureMember(projectId, user);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);

    const where = dto.requirementIds?.length
      ? { projectId, id: In(dto.requirementIds) }
      : { projectId };
    const requirements = await this.requirements.find({ where });
    if (!requirements.length) {
      throw new ValidationFailedException(
        'No requirements to analyse. Create requirements (or pass requirementIds) first.',
      );
    }

    const job = await this.jobs.create({
      projectId,
      type: 'analysis',
      correlationId,
      idempotencyKey,
      inputRefs: {
        requirementIds: requirements.map((r) => r.id),
        documentIds: dto.documentIds ?? [],
      },
      createdBy: user.id,
    });

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'analysis.generate',
      resourceType: 'job',
      resourceId: job.id,
      projectId,
      correlationId,
      metadata: { requirements: requirements.length },
    });

    this.jobs.dispatch(job, async () => {
      const run = await this.runs.save(
        this.runs.create({
          projectId,
          kind: 'analysis',
          jobId: job.id,
          inputRefs: { requirementIds: requirements.map((r) => r.id) },
          model: project.llmModel,
          temperature: project.llmTemperature,
          status: 'completed',
        }),
      );

      const analysisIds: string[] = [];
      for (const req of requirements) {
        const output = await this.engine.analyse(
          {
            requirementId: req.id,
            text: req.text,
            acceptanceCriteria: req.acceptanceCriteria ?? [],
            model: project.llmModel || undefined,
            temperature: project.llmTemperature,
          },
          correlationId,
          `${idempotencyKey || job.id}:${req.id}`,
        );
        const risk = (output.risk as { score?: number }) || {};
        const saved = await this.analyses.save(
          this.analyses.create({
            projectId,
            requirementId: req.id,
            generationRunId: run.id,
            schemaVersion: (output.schema_version as string) || 'v1',
            contentHash: contentHash(output),
            riskScore: risk.score ?? 5,
            output,
            model: project.llmModel,
            temperature: project.llmTemperature,
            createdBy: user.id,
          }),
        );
        analysisIds.push(saved.id);

        this.events.emit({
          type: 'analysis.ready',
          projectId,
          jobId: job.id,
          correlationId,
          payload: {
            analysisId: saved.id,
            requirementId: req.id,
            riskScore: saved.riskScore,
          },
        });
      }

      return {
        resultRefs: { analysisIds, generationRunId: run.id },
        readyEvent: {
          type: 'analysis.ready' as const,
          payload: { analysisIds, count: analysisIds.length },
        },
      };
    });

    return { jobId: job.id, status: job.status, requirements: requirements.length };
  }

  async listByProject(projectId: string, user: AuthUser): Promise<Analysis[]> {
    await this.membership.ensureMember(projectId, user);
    return this.analyses.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async getOne(id: string, user: AuthUser): Promise<Analysis> {
    const a = await this.analyses.findOne({ where: { id } });
    if (!a) throw new NotFoundAppException(`Analysis ${id} not found`);
    await this.membership.ensureMember(a.projectId, user);
    return a;
  }
}
