import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DocumentSegment, Requirement, SourceDocument } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { contentHash } from '../../common/hash';
import { AuditService } from '../audit/audit.service';

/**
 * Derives Requirement rows from parsed document segments so generation
 * (analysis, test plans, test cases) covers uploaded documents, not only
 * manually entered requirements (FR-IN-002/003/008: "Generated requirements
 * cite workbook, worksheet and cell or row source").
 *
 * Idempotent: segments already materialised as a requirement (matched by
 * content hash within the project) are returned, not duplicated.
 */
@Injectable()
export class RequirementDerivationService {
  private readonly logger = new Logger(RequirementDerivationService.name);

  constructor(
    @InjectRepository(Requirement)
    private readonly requirements: Repository<Requirement>,
    @InjectRepository(SourceDocument)
    private readonly documents: Repository<SourceDocument>,
    @InjectRepository(DocumentSegment)
    private readonly segments: Repository<DocumentSegment>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Returns every document-sourced requirement in scope (existing + newly
   * created). Scope is `documentIds` when given, otherwise all project
   * documents. Excluded segments (FR-IN-009) are skipped.
   */
  async deriveFromDocuments(
    projectId: string,
    documentIds: string[] | undefined,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Requirement[]> {
    const docWhere = documentIds?.length
      ? { projectId, id: In(documentIds) }
      : { projectId };
    const docs = await this.documents.find({ where: docWhere });
    if (!docs.length) return [];

    const existing = await this.requirements.find({ where: { projectId } });
    const byHash = new Map(existing.map((r) => [r.contentHash, r]));

    const derived: Requirement[] = [];
    let created = 0;
    for (const doc of docs) {
      if (['error', 'scanned'].includes(doc.parseStatus)) continue;
      const segs = await this.segments.find({
        where: { documentId: doc.id, inclusionStatus: 'included' },
        order: { sequence: 'ASC' },
      });
      for (const seg of segs) {
        const text = (seg.content || '').trim();
        if (!text) continue;
        const hash = contentHash({ text, ac: [] });
        const already = byHash.get(hash);
        if (already) {
          derived.push(already);
          continue;
        }
        const location =
          seg.rowOrSection || seg.pageOrSheet || `segment ${seg.sequence + 1}`;
        const saved = await this.requirements.save(
          this.requirements.create({
            projectId,
            source: 'document',
            version: 1,
            title: `${doc.filename} — ${location}`.slice(0, 250),
            text,
            acceptanceCriteria: [],
            status: 'draft',
            sourceDocumentId: doc.id,
            contentHash: hash,
            createdBy: user.id,
          }),
        );
        byHash.set(hash, saved);
        derived.push(saved);
        created += 1;
        await this.audit.record({
          actor: user.email,
          actorId: user.id,
          action: 'requirement.derive',
          resourceType: 'requirement',
          resourceId: saved.id,
          projectId,
          correlationId,
          metadata: { documentId: doc.id, filename: doc.filename, location },
        });
      }
    }
    if (created) {
      this.logger.log(
        `derived ${created} requirement(s) from documents for project ${projectId}`,
      );
    }
    return derived;
  }

  /**
   * Union of the explicitly requested requirements and everything derivable
   * from the project's documents — the shared input set for generation jobs.
   */
  async resolveGenerationScope(
    projectId: string,
    requirementIds: string[] | undefined,
    documentIds: string[] | undefined,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Requirement[]> {
    const derived = await this.deriveFromDocuments(
      projectId,
      documentIds,
      user,
      correlationId,
    );
    const where = requirementIds?.length
      ? { projectId, id: In(requirementIds) }
      : { projectId };
    const explicit = await this.requirements.find({ where });
    const seen = new Set(explicit.map((r) => r.id));
    return [...explicit, ...derived.filter((r) => !seen.has(r.id))];
  }
}
