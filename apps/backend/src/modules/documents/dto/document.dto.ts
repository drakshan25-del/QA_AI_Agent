import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DOCUMENT_CATEGORIES, DocumentCategory } from '../../../common/enums';

export class UploadDocumentsDto {
  /**
   * Category per file. Accepts either a single value applied to every file, or
   * a JSON array / repeated field aligned by upload index.
   */
  @ApiPropertyOptional({ enum: DOCUMENT_CATEGORIES })
  @IsOptional()
  category?: DocumentCategory;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  categories?: string | string[];
}

export class SegmentToggleDto {
  @ApiPropertyOptional()
  @IsString()
  segmentId!: string;

  @IsIn(['included', 'excluded'])
  inclusionStatus!: 'included' | 'excluded';
}

export class UpdateSegmentsDto {
  @ApiPropertyOptional({ type: [SegmentToggleDto] })
  @IsArray()
  segments!: SegmentToggleDto[];
}
