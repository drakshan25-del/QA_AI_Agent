import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Requirement } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
import { contentHash } from '../../common/hash';
import { AuditService } from '../audit/audit.service';
import { AuditEvent } from '../../entities';
import { MembershipService } from '../../common/access/membership.service';
import { CreateRequirementDto } from './dto/requirement.dto';

@Injectable()
export class RequirementsService {
  constructor(
    @InjectRepository(Requirement)
    private readonly requirements: Repository<Requirement>,
    @InjectRepository(AuditEvent)
    private readonly auditEvents: Repository<AuditEvent>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
  ) {}

  async create(
    projectId: string,
    dto: CreateRequirementDto,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Requirement> {
    await this.membership.ensureMember(projectId, user);
    const entity = this.requirements.create({
      projectId,
      source: dto.source || 'manual',
      version: 1,
      title: dto.title || '',
      text: dto.text,
      acceptanceCriteria: dto.acceptanceCriteria || [],
      status: 'draft',
      sourceDocumentId: dto.sourceDocumentId || null,
      contentHash: contentHash({
        text: dto.text,
        ac: dto.acceptanceCriteria || [],
      }),
      createdBy: user.id,
    });
    const saved = await this.requirements.save(entity);
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'requirement.create',
      resourceType: 'requirement',
      resourceId: saved.id,
      projectId,
      correlationId,
      metadata: { version: saved.version, source: saved.source },
    });
    return saved;
  }

  async listByProject(
    projectId: string,
    user: AuthUser,
  ): Promise<Requirement[]> {
    await this.membership.ensureMember(projectId, user);
    return this.requirements.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async getOne(id: string, user: AuthUser): Promise<Requirement> {
    const req = await this.requirements.findOne({ where: { id } });
    if (!req) throw new NotFoundAppException(`Requirement ${id} not found`);
    await this.membership.ensureMember(req.projectId, user);
    return req;
  }

  /** History from the audit trail for this requirement (FR-IN-006). */
  async history(id: string, user: AuthUser): Promise<AuditEvent[]> {
    await this.getOne(id, user);
    return this.auditEvents.find({
      where: { resourceType: 'requirement', resourceId: id },
      order: { createdAt: 'DESC' },
    });
  }

  /** Version chain (single current version in this tier, FR-IN-006). */
  async versions(
    id: string,
    user: AuthUser,
  ): Promise<{ version: number; contentHash: string; createdAt: Date }[]> {
    const req = await this.getOne(id, user);
    return [
      {
        version: req.version,
        contentHash: req.contentHash,
        createdAt: req.updatedAt,
      },
    ];
  }
}
