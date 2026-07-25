import { DocumentCategory } from '../../../common/enums';
export declare class UploadDocumentsDto {
    category?: DocumentCategory;
    categories?: string | string[];
}
export declare class SegmentToggleDto {
    segmentId: string;
    inclusionStatus: 'included' | 'excluded';
}
export declare class UpdateSegmentsDto {
    segments: SegmentToggleDto[];
}
