"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentHash = contentHash;
const crypto_1 = require("crypto");
function contentHash(value) {
    if (Buffer.isBuffer(value)) {
        return (0, crypto_1.createHash)('sha256').update(value).digest('hex');
    }
    const canonical = typeof value === 'string' ? value : stableStringify(value);
    return (0, crypto_1.createHash)('sha256').update(canonical).digest('hex');
}
function stableStringify(value) {
    return JSON.stringify(value, (_key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            return Object.keys(val)
                .sort()
                .reduce((acc, k) => {
                acc[k] = val[k];
                return acc;
            }, {});
        }
        return val;
    });
}
//# sourceMappingURL=hash.js.map