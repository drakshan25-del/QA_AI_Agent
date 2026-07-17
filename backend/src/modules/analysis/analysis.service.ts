import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { RequirementDerivationService } from '../requirements/requirement-derivation.service';
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
    private readonly derivation: RequirementDerivationService,
    private readonly engine: EngineClient,
  ) {
    this.jobs.registerRetryHandler('analysis', (original, user, correlationId) =>
      this.createJob(
        original.projectId,
        {
          requirementIds:
            (original.inputRefs?.requirementIds as string[]) ?? undefined,
          documentIds:
            (original.inputRefs?.documentIds as string[]) ?? undefined,
        },
        user,
        correlationId,
      ),
    );
  }

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

    // Documents count as input too: derive requirements from their included
    // segments so analysis covers uploads, not only manual entries (FR-IN-008).
    const requirements = await this.derivation.resolveGenerationScope(
      projectId,
      dto.requirementIds,
      dto.documentIds,
      user,
      correlationId,
    );
    if (!requirements.length) {
      throw new ValidationFailedException(
        'No requirements to analyse. Add requirements or upload documents first.',
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

    this.jobs.dispatch(job, async (j, ctx) => {
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

      await ctx.log({
        stage: 'document parsing',
        message: `Analysing ${requirements.length} requirement(s) with ${project.llmModel || 'the default model'}`,
        progress: 8,
      });

      const analysisIds: string[] = [];
      let index = 0;
      for (const req of requirements) {
        await ctx.checkpoint();
        index += 1;
        await ctx.log({
          stage: 'requirement analysis',
          message: `Requirement ${index}/${requirements.length}: "${req.title || req.id}" — extracting actors, flows, rules, risks and gaps`,
          progress: 8 + Math.round(((index - 1) / requirements.length) * 84),
        });
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
        await ctx.log({
          stage: 'requirement analysis',
          severity: 'success',
          message: `Requirement ${index}/${requirements.length}: analysis stored (risk score ${saved.riskScore}/10)`,
          progress: 8 + Math.round((index / requirements.length) * 84),
        });

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
