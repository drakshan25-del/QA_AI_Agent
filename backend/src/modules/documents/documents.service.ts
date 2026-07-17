import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { DocumentSegment, SourceDocument } from '../../entities';
import { DocumentCategory } from '../../common/enums';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
import { contentHash } from '../../common/hash';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import {
  UploadedFileLike,
  validateUpload,
} from './file-validation';

export interface PerFileUploadResult {
  filename: string;
  category: string;
  status: 'accepted' | 'rejected';
  documentId?: string;
  parseStatus?: string;
  segments?: number;
  reason?: string;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(SourceDocument)
    private readonly documents: Repository<SourceDocument>,
    @InjectRepository(DocumentSegment)
    private readonly segments: Repository<DocumentSegment>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly engine: EngineClient,
    private readonly config: ConfigService,
  ) {}

  private get maxBytes(): number {
    return this.config.get<number>('maxUploadBytes')!;
  }

  private get uploadDir(): string {
    return this.config.get<string>('uploadDir')!;
  }

  async upload(
    projectId: string,
    files: UploadedFileLike[],
    categories: DocumentCategory[],
    user: AuthUser,
    correlationId?: string,
  ): Promise<PerFileUploadResult[]> {
    await this.membership.ensureMember(projectId, user);

    const results: PerFileUploadResult[] = [];
    const toParse: {
      index: number;
      file: UploadedFileLike;
      category: DocumentCategory;
    }[] = [];

    // 1) Backend validation BEFORE calling the engine (FR-IN-010).
    files.forEach((file, i) => {
      const category = categories[i] || 'user_story';
      const v = validateUpload(file, this.maxBytes);
      if (!v.ok) {
        results[i] = {
          filename: file.originalname,
          category,
          status: 'rejected',
          reason: v.reason,
        };
        void this.audit.record({
          actor: user.email,
          actorId: user.id,
          action: 'document.upload.rejected',
          resourceType: 'document',
          projectId,
          result: 'failure',
          correlationId,
          metadata: { filename: file.originalname, reason: v.reason },
        });
      } else {
        toParse.push({ index: i, file, category });
      }
    });

    // 2) Parse the accepted files via the engine, persist doc + segments.
    if (toParse.length) {
      const parsed = await this.engine.parse(
        toParse.map((t) => ({
          filename: t.file.originalname,
          category: t.category,
          contentBase64: t.file.buffer.toString('base64'),
        })),
        correlationId,
      );

      for (let k = 0; k < toParse.length; k++) {
        const { index, file, category } = toParse[k];
        const doc = parsed.documents[k];
        const hash = contentHash(file.buffer);
        const storagePath = await this.persistFile(projectId, file);

        const entity = this.documents.create({
          projectId,
          filename: file.originalname,
          category,
          kind: doc?.kind || '',
          mimeType: file.mimetype,
          sizeBytes: file.size,
          parseStatus: doc?.parse_status || 'parsed',
          message: doc?.message || '',
          storagePath,
          contentHash: hash,
          uploadedBy: user.id,
        });
        const savedDoc = await this.documents.save(entity);

        const segs = (doc?.segments || []).map((s, seq) =>
          this.segments.create({
            documentId: savedDoc.id,
            sequence: seq,
            pageOrSheet: s.page_or_sheet || '',
            rowOrSection: s.row_or_section || '',
            content: s.content || '',
            metadata: (s.metadata as Record<string, unknown>) || null,
            inclusionStatus: s.inclusion_status || 'included',
          }),
        );
        if (segs.length) await this.segments.save(segs);

        await this.audit.record({
          actor: user.email,
          actorId: user.id,
          action: 'document.upload',
          resourceType: 'document',
          resourceId: savedDoc.id,
          projectId,
          correlationId,
          metadata: {
            filename: file.originalname,
            category,
            parseStatus: savedDoc.parseStatus,
            segments: segs.length,
          },
        });

        results[index] = {
          filename: file.originalname,
          category,
          status: 'accepted',
          documentId: savedDoc.id,
          parseStatus: savedDoc.parseStatus,
          segments: segs.length,
        };
      }
    }

    return results;
  }

  private async persistFile(
    projectId: string,
    file: UploadedFileLike,
  ): Promise<string> {
    try {
      const dir = join(this.uploadDir, 'documents', projectId);
      await fs.mkdir(dir, { recursive: true });
      const safe = `${Date.now()}-${file.originalname.replace(/[^\w.\-]/g, '_')}`;
      const path = join(dir, safe);
      await fs.writeFile(path, file.buffer);
      return path;
    } catch (err) {
      this.logger.warn(`could not persist upload to disk: ${(err as Error).message}`);
      return '';
    }
  }

  async listByProject(
    projectId: string,
    user: AuthUser,
  ): Promise<SourceDocument[]> {
    await this.membership.ensureMember(projectId, user);
    return this.documents.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async getOne(id: string, user: AuthUser): Promise<SourceDocument> {
    const doc = await this.documents.findOne({ where: { id } });
    if (!doc) throw new NotFoundAppException(`Document ${id} not found`);
    await this.membership.ensureMember(doc.projectId, user);
    return doc;
  }

  async preview(
    id: string,
    user: AuthUser,
  ): Promise<{ document: SourceDocument; segments: DocumentSegment[] }> {
    const doc = await this.getOne(id, user);
    const segments = await this.segments.find({
      where: { documentId: id },
      order: { sequence: 'ASC' },
    });
    return { document: doc, segments };
  }

  async updateSegments(
    id: string,
    updates: { segmentId: string; inclusionStatus: 'included' | 'excluded' }[],
    user: AuthUser,
    correlationId?: string,
  ): Promise<DocumentSegment[]> {
    const doc = await this.getOne(id, user);
    for (const u of updates) {
      await this.segments.update(
        { id: u.segmentId, documentId: id },
        { inclusionStatus: u.inclusionStatus },
      );
    }
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'document.segments.update',
      resourceType: 'document',
      resourceId: id,
      projectId: doc.projectId,
      correlationId,
      metadata: { count: updates.length },
    });
    return this.segments.find({
      where: { documentId: id },
      order: { sequence: 'ASC' },
    });
  }

  async remove(id: string, user: AuthUser, correlationId?: string): Promise<void> {
    const doc = await this.getOne(id, user);
    await this.segments.delete({ documentId: id });
    await this.documents.delete({ id });
    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'document.delete',
      resourceType: 'document',
      resourceId: id,
      projectId: doc.projectId,
      correlationId,
    });
  }
}
