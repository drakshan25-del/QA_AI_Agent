import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { UpdateSegmentsDto } from './dto/document.dto';
import {
  AuthUser,
  CorrelationId,
  CurrentUser,
} from '../../common/decorators';
import { ProjectMemberGuard } from '../../common/access/project-member.guard';
import {
  DOCUMENT_CATEGORIES,
  DocumentCategory,
} from '../../common/enums';
import { ValidationFailedException } from '../../common/errors';
import { UploadedFileLike } from './file-validation';
import { RequirePermission } from '../../common/access/permissions';

const MAX_FILES = 20;

@ApiTags('documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('projects/:projectId/documents')
  @RequirePermission('document.upload')
  @UseGuards(ProjectMemberGuard)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { fileSize: 25 * 1024 * 1024, files: MAX_FILES },
    }),
  )
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    if (!files || files.length === 0) {
      throw new ValidationFailedException('No files uploaded (field: files)');
    }
    const categories = resolveCategories(body, files.length);
    const results = await this.documents.upload(
      projectId,
      files as unknown as UploadedFileLike[],
      categories,
      user,
      correlationId,
    );
    return { documents: results };
  }

  @Get('projects/:projectId/documents')
  @UseGuards(ProjectMemberGuard)
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documents.listByProject(projectId, user);
  }

  @Get('documents/:id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documents.getOne(id, user);
  }

  @Get('documents/:id/preview')
  async preview(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documents.preview(id, user);
  }

  @Patch('documents/:id/segments')
  async updateSegments(
    @Param('id') id: string,
    @Body() dto: UpdateSegmentsDto,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ) {
    return this.documents.updateSegments(id, dto.segments, user, correlationId);
  }

  @Delete('documents/:id')
  @RequirePermission('document.upload')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @CorrelationId() correlationId: string,
  ): Promise<void> {
    await this.documents.remove(id, user, correlationId);
  }
}

function coerceCategory(value: unknown): DocumentCategory {
  const v = String(value || '').trim();
  return (DOCUMENT_CATEGORIES as readonly string[]).includes(v)
    ? (v as DocumentCategory)
    : 'user_story';
}

function resolveCategories(
  body: Record<string, unknown>,
  count: number,
): DocumentCategory[] {
  const single = body.category ? coerceCategory(body.category) : undefined;
  let list: DocumentCategory[] | undefined;

  const raw = body.categories;
  if (Array.isArray(raw)) {
    list = raw.map(coerceCategory);
  } else if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed) as unknown[];
        list = arr.map(coerceCategory);
      } catch {
        list = trimmed.split(',').map(coerceCategory);
      }
    } else {
      list = trimmed.split(',').map(coerceCategory);
    }
  }

  const out: DocumentCategory[] = [];
  for (let i = 0; i < count; i++) {
    out.push(list?.[i] ?? single ?? 'user_story');
  }
  return out;
}
