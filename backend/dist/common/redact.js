"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redact = redact;
exports.redactText = redactText;
const SECRET_KEY_HINTS = [
    'password',
    'passwd',
    'pwd',
    'secret',
    'token',
    'authorization',
    'auth',
    'credential',
    'apikey',
    'api_key',
    'cookie',
];
const MASK = '***';
function redact(value, depth = 0) {
    if (depth > 6 || value === null || value === undefined)
        return value;
    if (Array.isArray(value)) {
        return value.map((v) => redact(v, depth + 1));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const low = k.toLowerCase();
            if (SECRET_KEY_HINTS.some((h) => low.includes(h))) {
                out[k] = MASK;
            }
            else {
                out[k] = redact(v, depth + 1);
            }
        }
        return out;
    }
    return value;
}
function redactText(text) {
    if (!text)
        return text;
    return text.replace(/(password|passwd|pwd|secret|token|credential)([=:\s]+)(\S+)/gi, (_m, label, sep) => `${label}${sep}${MASK}`);
}
//# sourceMappingURL=redact.js.map