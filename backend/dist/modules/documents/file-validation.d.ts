export interface UploadedFileLike {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
}
export interface FileValidationResult {
    ok: boolean;
    ext: string;
    reason?: string;
}
export declare const ALLOWED_EXTENSIONS: string[];
export declare function validateUpload(file: UploadedFileLike, maxBytes: number): FileValidationResult;
