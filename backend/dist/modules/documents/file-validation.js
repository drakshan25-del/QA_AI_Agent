"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_EXTENSIONS = void 0;
exports.validateUpload = validateUpload;
const path_1 = require("path");
const ALLOWED = {
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
exports.ALLOWED_EXTENSIONS = Object.keys(ALLOWED);
function validateUpload(file, maxBytes) {
    const ext = (0, path_1.extname)(file.originalname).toLowerCase();
    if (!ext || !(ext in ALLOWED)) {
        return {
            ok: false,
            ext,
            reason: `Unsupported file type "${ext || 'none'}". Allowed: ` +
                `${exports.ALLOWED_EXTENSIONS.join(', ')}.`,
        };
    }
    if (file.size > maxBytes) {
        return {
            ok: false,
            ext,
            reason: `File is ${(file.size / (1024 * 1024)).toFixed(1)}MB which exceeds the ` +
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
            reason: `Declared content type "${file.mimetype}" does not match a ${ext} file.`,
        };
    }
    const encrypted = detectEncrypted(ext, file.buffer);
    if (encrypted) {
        return {
            ok: false,
            ext,
            reason: 'File appears to be password-protected/encrypted. Remove protection ' +
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
    if (detectExecutable(file.buffer)) {
        return {
            ok: false,
            ext,
            reason: 'File rejected: content matches an executable binary signature and ' +
                'will not be processed.',
        };
    }
    if (detectMacros(file.originalname, ext, file.buffer)) {
        return {
            ok: false,
            ext,
            reason: 'File rejected: it contains an embedded VBA macro project. Save it ' +
                'as a macro-free document (.docx/.xlsx) and re-upload.',
        };
    }
    return { ok: true, ext };
}
function detectEncrypted(ext, buf) {
    if (ext === '.pdf') {
        const head = buf.subarray(0, Math.min(buf.length, 200_000)).toString('latin1');
        return /\/Encrypt\b/.test(head);
    }
    if (ext === '.docx' || ext === '.xlsx') {
        if (buf.length >= 8 &&
            buf[0] === 0xd0 &&
            buf[1] === 0xcf &&
            buf[2] === 0x11 &&
            buf[3] === 0xe0) {
            return true;
        }
        if (buf.length >= 8 &&
            buf[0] === 0x50 &&
            buf[1] === 0x4b &&
            buf[2] === 0x03 &&
            buf[3] === 0x04) {
            const flags = buf.readUInt16LE(6);
            if ((flags & 0x0001) !== 0)
                return true;
        }
    }
    return false;
}
function detectExecutable(buf) {
    if (buf.length < 4)
        return false;
    if (buf[0] === 0x4d && buf[1] === 0x5a)
        return true;
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
        return true;
    }
    const macho = buf.readUInt32BE(0);
    return [0xfeedface, 0xfeedfacf, 0xcafebabe].includes(macho);
}
function detectMacros(filename, ext, buf) {
    const lowerName = filename.toLowerCase();
    if (/\.(docm|xlsm|pptm|dotm|xltm)$/.test(lowerName))
        return true;
    if (ext !== '.docx' && ext !== '.xlsx')
        return false;
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b)
        return false;
    const haystack = buf.toString('latin1');
    return haystack.includes('vbaProject.bin');
}
function detectZipBomb(ext, buf) {
    if (ext !== '.docx' && ext !== '.xlsx')
        return false;
    if (buf.length < 30 ||
        !(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
        return false;
    }
    const compressed = buf.readUInt32LE(18);
    const uncompressed = buf.readUInt32LE(22);
    if (compressed > 0 && uncompressed / compressed > 500 && uncompressed > 50_000_000) {
        return true;
    }
    return false;
}
//# sourceMappingURL=file-validation.js.map