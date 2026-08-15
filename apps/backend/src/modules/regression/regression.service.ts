import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import {
  ExecutionRun,
  RegressionComparison,
  TestResult,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import { CompareRegressionDto } from './dto/regression.dto';

@Injectable()
export class RegressionService {
  constructor(
    @InjectRepository(RegressionComparison)
    private readonly comparisons: Repository<RegressionComparison>,
    @InjectRepository(ExecutionRun)
    private readonly runs: Repository<ExecutionRun>,
    @InjectRepository(TestResult)
    private readonly results: Repository<TestResult>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly engine: EngineClient,
  ) {}

  /** Loads a run and rejects ids that belong to another project. */
  private async loadProjectRun(
    projectId: string,
    runId: string,
    label: string,
  ): Promise<ExecutionRun> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundAppException(`Execution ${runId} not found`);
    if (run.projectId !== projectId) {
      throw new ValidationFailedException(
        `${label} run ${runId} does not belong to project ${projectId}.`,
        { runId, projectId },
      );
    }
    return run;
  }

  /** Per-test outcomes of a run in the engine's compare wire format. */
  private async outcomes(
    runId: string,
  ): Promise<{ node_id: string; outcome: string }[]> {
    const rows = await this.results.find({ where: { executionRunId: runId } });
    return rows.map((r) => ({ node_id: r.nodeId, outcome: r.outcome }));
  }

  /**
   * Synchronous baseline-vs-candidate comparison: the engine classifies each
   * test's outcome transition (stateless, no job) and the full dict is
   * persisted so past comparisons remain reviewable.
   */
  async compare(
    projectId: string,
    dto: CompareRegressionDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<RegressionComparison> {
    await this.membership.ensureMember(projectId, user);
    const baseline = await this.loadProjectRun(
      projectId,
      dto.baselineRunId,
      'Baseline',
    );
    const candidate = await this.loadProjectRun(
      projectId,
      dto.candidateRunId,
      'Candidate',
    );

    const result = await this.engine.regressionCompare(
      {
        baseline: await this.outcomes(baseline.id),
        current: await this.outcomes(candidate.id),
      },
      correlationId,
    );

    const saved = await this.comparisons.save(
      this.comparisons.create({
        projectId,
        baselineRunId: baseline.id,
        candidateRunId: candidate.id,
        result: result as unknown as Record<string, unknown>,
        hasRegressions: result.summary.has_regressions,
        createdBy: user.id,
        correlationId: correlationId ?? null,
      }),
    );

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'regression.compare',
      resourceType: 'regression_comparison',
      resourceId: saved.id,
      projectId,
      correlationId,
      metadata: {
        baselineRunId: baseline.id,
        candidateRunId: candidate.id,
        summary: result.summary,
      },
    });

    return saved;
  }

  async listByProject(
    projectId: string,
    user: AuthUser,
  ): Promise<RegressionComparison[]> {
    await this.membership.ensureMember(projectId, user);
    return this.comparisons.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async getOne(id: string, user: AuthUser): Promise<RegressionComparison> {
    const record = await this.comparisons.findOne({ where: { id } });
    if (!record) {
      throw new NotFoundAppException(`Regression comparison ${id} not found`);
    }
    await this.membership.ensureMember(record.projectId, user);
    return record;
  }

  /**
   * Promote a run to the project's regression baseline. Single-baseline
   * invariant: the flag is first cleared on every other run of the project,
   * so a promotion always replaces the previous baseline.
   */
  async promoteBaseline(
    runId: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<ExecutionRun> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundAppException(`Execution ${runId} not found`);
    await this.membership.ensureMember(run.projectId, user);

    await this.runs.update(
      { projectId: run.projectId, id: Not(runId) },
      { isBaseline: false },
    );
    run.isBaseline = true;
    const saved = await this.runs.save(run);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'execution.baseline',
      resourceType: 'execution',
      resourceId: runId,
      projectId: run.projectId,
      correlationId,
      metadata: { isBaseline: true },
    });

    return saved;
  }
}
