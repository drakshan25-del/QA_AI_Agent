import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionRun, Finding, TestResult } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
import { FindingClassification } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';

@Injectable()
export class FindingsService {
  constructor(
    @InjectRepository(Finding) private readonly findings: Repository<Finding>,
    @InjectRepository(TestResult)
    private readonly results: Repository<TestResult>,
    @InjectRepository(ExecutionRun)
    private readonly runs: Repository<ExecutionRun>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly engine: EngineClient,
  ) {}

  private async projectOfResult(result: TestResult): Promise<ExecutionRun> {
    const run = await this.runs.findOne({
      where: { id: result.executionRunId },
    });
    if (!run) {
      throw new NotFoundAppException(
        `Execution ${result.executionRunId} not found`,
      );
    }
    return run;
  }

  async classify(
    resultId: string,
    context: string | undefined,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Finding> {
    const result = await this.results.findOne({ where: { id: resultId } });
    if (!result) throw new NotFoundAppException(`Result ${resultId} not found`);
    const run = await this.projectOfResult(result);
    await this.membership.ensureMember(run.projectId, user);

    const output = await this.engine.classify(
      {
        test: {
          node_id: result.nodeId,
          outcome: result.outcome,
          error_message: result.errorMessage,
        },
        context: { note: context || '', metrics: run.metrics || {} },
      },
      correlationId,
    );

    const finding = await this.findings.save(
      this.findings.create({
        projectId: run.projectId,
        executionRunId: run.id,
        testResultId: result.id,
        classification:
          (output.classification as FindingClassification) || 'inconclusive',
        confidence: (output.confidence as number) ?? 0.5,
        rationale: (output.rationale as string) || '',
        severity: (output.severity as string) || 'medium',
        overridden: false,
        createdBy: user.id,
      }),
    );

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

  async getOne(id: string, user: AuthUser): Promise<Finding> {
    const finding = await this.findings.findOne({ where: { id } });
    if (!finding) throw new NotFoundAppException(`Finding ${id} not found`);
    await this.membership.ensureMember(finding.projectId, user);
    return finding;
  }

  async override(
    id: string,
    classification: FindingClassification,
    reason: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Finding> {
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

  /** Assemble a defect draft from the finding + test result (FR-BUG-001). */
  async defectDraft(
    id: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
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
}
