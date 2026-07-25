"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATETIME_TYPE = void 0;
const isPostgres = (process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'postgres';
exports.DATETIME_TYPE = isPostgres ? 'timestamp' : 'datetime';
//# sourceMappingURL=column-types.js.map