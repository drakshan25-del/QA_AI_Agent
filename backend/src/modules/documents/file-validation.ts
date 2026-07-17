import { extname } from 'path';

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

/** Allowed extensions and their acceptable MIME types (FR-IN-010). */
const ALLOWED: Record<string, string[]> = {
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
    'application/zip',
  ],
  '.pdf': ['application/pdf', 'application/octet-stream'],
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
    'application/zip',
  ],
  '.xls': [
    'application/vnd.ms-excel',
    'application/octet-stream',
  ],
  '.txt': ['text/plain', 'application/octet-stream'],
  '.md': ['text/markdown', 'text/plain', 'text/x-markdown', 'application/octet-stream'],
  '.json': ['application/json', 'text/plain', 'application/octet-stream'],
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

/**
 * Backend validation that runs BEFORE the engine parse (FR-IN-010): size,
 * MIME+extension allow-list, and rejection of encrypted / obviously malicious
 * archives with an actionable message.
 */
export function validateUpload(
  file: UploadedFileLike,
  maxBytes: number,
): FileValidationResult {
  const ext = extname(file.originalname).toLowerCase();

  if (!ext || !(ext in ALLOWED)) {
    return {
      ok: false,
      ext,
      reason:
        `Unsupported file type "${ext || 'none'}". Allowed: ` +
        `${ALLOWED_EXTENSIONS.join(', ')}.`,
    };
  }

  if (file.size > maxBytes) {
    return {
      ok: false,
      ext,
      reason:
        `File is ${(file.size / (1024 * 1024)).toFixed(1)}MB which exceeds the ` +
        `${(maxBytes / (1024 * 1024)).toFixed(0)}MB limit. Split or compress it.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, ext, reason: 'File is empty.' };
  }

  const acceptable = ALLOWED[ext];
  const mime = (file.mimetype || '').toLowerCase();
  if (mime && !acceptable.includes(mime)) {
    return {
      ok: false,
      ext,
      reason:
        `Declared content type "${file.mimetype}" does not match a ${ext} file.`,
    };
  }

  const encrypted = detectEncrypted(ext, file.buffer);
  if (encrypted) {
    return {
      ok: false,
      ext,
      reason:
        'File appears to be password-protected/encrypted. Remove protection ' +
        'and re-upload.',
    };
  }

  const bomb = detectZipBomb(ext, file.buffer);
  if (bomb) {
    return {
      ok: false,
      ext,
      reason: 'Archive rejected: suspicious compression ratio (possible zip bomb).',
    };
  }

  return { ok: true, ext };
}

function detectEncrypted(ext: string, buf: Buffer): boolean {
  if (ext === '.pdf') {
    // Scan a bounded window for the /Encrypt dictionary marker.
    const head = buf.subarray(0, Math.min(buf.length, 200_000)).toString('latin1');
    return /\/Encrypt\b/.test(head);
  }
  if (ext === '.docx' || ext === '.xlsx') {
    // OOXML is a ZIP. Encrypted OOXML is an OLE compound file ("MS-CFB",
    // magic D0 CF 11 E0) rather than a ZIP (PK\x03\x04). Also honour the ZIP
    // local-header "encrypted" general-purpose bit.
    if (
      buf.length >= 8 &&
      buf[0] === 0xd0 &&
      buf[1] === 0xcf &&
      buf[2] === 0x11 &&
      buf[3] === 0xe0
    ) {
      return true;
    }
    if (
      buf.length >= 8 &&
      buf[0] === 0x50 &&
      buf[1] === 0x4b &&
      buf[2] === 0x03 &&
      buf[3] === 0x04
    ) {
      const flags = buf.readUInt16LE(6);
      if ((flags & 0x0001) !== 0) return true;
    }
  }
  return false;
}

function detectZipBomb(ext: string, buf: Buffer): boolean {
  if (ext !== '.docx' && ext !== '.xlsx') return false;
  if (
    buf.length < 30 ||
    !(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)
  ) {
    return false;
  }
  // First local file header: compressed (18) and uncompressed (22) sizes.
  const compressed = buf.readUInt32LE(18);
  const uncompressed = buf.readUInt32LE(22);
  if (compressed > 0 && uncompressed / compressed > 500 && uncompressed > 50_000_000) {
    return true;
  }
  return false;
}
