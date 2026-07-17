import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, ObjectLiteral, Repository } from 'typeorm';
import {
  Approval,
  GeneratedArtifact,
  TestCase,
  TestPlan,
} from '../../entities';
import {
  ApprovalDecision,
  ApprovalResourceType,
  ApprovalStatus,
} from '../../common/enums';
import { AuthUser } from '../../common/decorators';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';

interface ApprovableEntity {
  id: string;
  projectId: string;
  version: number;
  approvalStatus: ApprovalStatus;
  approvalInvalidated: boolean;
}

/**
 * Central approval-gate authority (FR-HITL-005, FR-TP-005, FR-TC-009,
 * FR-AUT-010, FR-VAL-007). Records decisions against a specific artefact
 * version, mutates the resource's approvalStatus, emits `approval.updated`,
 * and exposes precondition checks that raise 409 on invalid transitions
 * (FR-BE-005). Modifying an approved upstream artefact invalidates the
 * approval of anything generated from it (FR-VAL-007).
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    @InjectRepository(Approval)
    private readonly approvals: Repository<Approval>,
    @InjectRepository(TestPlan)
    private readonly testPlans: Repository<TestPlan>,
    @InjectRepository(TestCase)
    private readonly testCases: Repository<TestCase>,
    @InjectRepository(GeneratedArtifact)
    private readonly artifacts: Repository<GeneratedArtifact>,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private repoFor(type: ApprovalResourceType): Repository<ObjectLiteral> {
    switch (type) {
      case 'test_plan':
        return this.testPlans as Repository<ObjectLiteral>;
      case 'test_case':
        return this.testCases as Repository<ObjectLiteral>;
      case 'automation':
        return this.artifacts as Repository<ObjectLiteral>;
      default:
        // validation_exception / report gates are record-only decisions
        // (recordStandalone) — they have no mutable artefact row.
        throw new ConflictAppException(
          `Approval type ${type} is record-only; use the dedicated endpoint.`,
          'unsupported_approval_type',
        );
    }
  }

  /**
   * Record-only approval for gates without a mutable artefact row
   * (FR-V3-ENT-002): validation exceptions and report publication.
   */
  async recordStandalone(
    type: Extract<ApprovalResourceType, 'validation_exception' | 'report'>,
    resourceId: string,
    projectId: string,
    decision: ApprovalDecision,
    comment: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Approval> {
    const record = await this.approvals.save(
      this.approvals.create({
        projectId,
        resourceType: type,
        resourceId,
        resourceVersion: 1,
        decision,
        comment: comment || '',
        invalidated: false,
        actorId: user.id,
        actor: user.email,
      }),
    );
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: `approval.${decision}`,
      resourceType: type,
      resourceId,
      projectId,
      correlationId,
      metadata: { decision },
    });
    this.events.emit({
      type: 'approval.updated',
      projectId,
      correlationId,
      payload: { resourceType: type, resourceId, decision },
    });
    return record;
  }

  /** Latest standalone decision for a record-only gate, if any. */
  async latestStandalone(
    type: Extract<ApprovalResourceType, 'validation_exception' | 'report'>,
    resourceId: string,
  ): Promise<Approval | null> {
    return this.approvals.findOne({
      where: { resourceType: type, resourceId },
      order: { createdAt: 'DESC' },
    });
  }

  private async load(
    type: ApprovalResourceType,
    id: string,
  ): Promise<ApprovableEntity> {
    const entity = (await this.repoFor(type).findOne({
      where: { id },
    })) as ApprovableEntity | null;
    if (!entity) {
      throw new NotFoundAppException(`${type} ${id} not found`);
    }
    return entity;
  }

  async decide(
    type: ApprovalResourceType,
    id: string,
    decision: ApprovalDecision,
    comment: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<{ id: string; approvalStatus: ApprovalStatus; version: number }> {
    const entity = await this.load(type, id);

    const nextStatus: ApprovalStatus =
      decision === 'approved'
        ? 'approved'
        : decision === 'rejected'
          ? 'rejected'
          : 'pending';

    entity.approvalStatus = nextStatus;
    entity.approvalInvalidated = false;
    await this.repoFor(type).save(entity as unknown as ObjectLiteral);

    const record = this.approvals.create({
      projectId: entity.projectId,
      resourceType: type,
      resourceId: id,
      resourceVersion: entity.version,
      decision,
      comment: comment || '',
      invalidated: false,
      actorId: user.id,
      actor: user.email,
    });
    await this.approvals.save(record);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: `approval.${decision}`,
      resourceType: type,
      resourceId: id,
      projectId: entity.projectId,
      correlationId,
      metadata: { decision, version: entity.version },
    });

    this.events.emit({
      type: 'approval.updated',
      projectId: entity.projectId,
      correlationId,
      payload: {
        resourceType: type,
        resourceId: id,
        decision,
        approvalStatus: nextStatus,
        version: entity.version,
      },
    });

    // Regenerate/reject of an upstream artefact invalidates downstream.
    if (decision !== 'approved') {
      await this.invalidateDownstream(type, id, user, correlationId);
    }

    return { id, approvalStatus: nextStatus, version: entity.version };
  }

  async decideBulk(
    type: ApprovalResourceType,
    ids: string[],
    decision: ApprovalDecision,
    comment: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<{ id: string; approvalStatus: ApprovalStatus; version: number }[]> {
    const out = [];
    for (const id of ids) {
      out.push(
        await this.decide(type, id, decision, comment, user, correlationId),
      );
    }
    return out;
  }

  /** Raises 409 unless the resource is currently approved (and not stale). */
  async ensureApproved(
    type: ApprovalResourceType,
    id: string,
  ): Promise<ApprovableEntity> {
    const entity = await this.load(type, id);
    if (entity.approvalStatus !== 'approved' || entity.approvalInvalidated) {
      throw new ConflictAppException(
        `${type} ${id} is not approved (status=${entity.approvalStatus}` +
          `${entity.approvalInvalidated ? ', invalidated by upstream change' : ''}). ` +
          `Approval is required before this action.`,
        'approval_required',
        { resourceType: type, resourceId: id, approvalStatus: entity.approvalStatus },
      );
    }
    return entity;
  }

  /**
   * FR-VAL-007 — a change to an approved upstream artefact invalidates the
   * approval of anything derived from it. Called by the edit endpoints.
   */
  async onUpstreamModified(
    type: ApprovalResourceType,
    id: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<void> {
    const entity = await this.load(type, id);
    if (entity.approvalStatus === 'approved') {
      entity.approvalStatus = 'pending';
      entity.approvalInvalidated = true;
      await this.repoFor(type).save(entity as unknown as ObjectLiteral);
      await this.markApprovalsInvalidated(type, id);
      this.emitInvalidated(type, id, entity.projectId, correlationId);
    }
    await this.invalidateDownstream(type, id, user, correlationId);
  }

  private async invalidateDownstream(
    type: ApprovalResourceType,
    id: string,
    _user: AuthUser,
    correlationId?: string,
  ): Promise<void> {
    if (type === 'test_case') {
      // Automation generated from this test case is no longer trustworthy.
      const arts = await this.artifacts.find({
        where: { status: 'active' },
      });
      const affected = arts.filter((a) =>
        (a.testCaseIds ?? []).includes(id),
      );
      for (const a of affected) {
        if (a.approvalStatus === 'approved' || a.validationStatus === 'passed') {
          a.approvalStatus = 'pending';
          a.approvalInvalidated = true;
          a.validationStatus = 'pending';
          await this.artifacts.save(a);
          await this.markApprovalsInvalidated('automation', a.id);
          this.emitInvalidated('automation', a.id, a.projectId, correlationId);
        }
      }
    }
  }

  private async markApprovalsInvalidated(
    type: ApprovalResourceType,
    id: string,
  ): Promise<void> {
    await this.approvals.update(
      { resourceType: type, resourceId: id, decision: 'approved' },
      { invalidated: true },
    );
  }

  private emitInvalidated(
    type: ApprovalResourceType,
    id: string,
    projectId: string,
    correlationId?: string,
  ): void {
    this.events.emit({
      type: 'approval.updated',
      projectId,
      correlationId,
      payload: {
        resourceType: type,
        resourceId: id,
        approvalStatus: 'pending',
        invalidated: true,
      },
    });
  }

  async history(resourceId: string): Promise<Approval[]> {
    return this.approvals.find({
      where: { resourceId },
      order: { createdAt: 'DESC' },
    });
  }

  async listByIds(ids: string[]): Promise<Approval[]> {
    if (!ids.length) return [];
    return this.approvals.find({ where: { resourceId: In(ids) } });
  }
}
