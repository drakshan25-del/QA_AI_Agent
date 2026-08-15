import { ColumnType } from 'typeorm';

/**
 * Portable column types across the two drivers (§5):
 *   - SQLite (better-sqlite3) supports `datetime` but not `timestamp`.
 *   - Postgres supports `timestamp` but not `datetime`.
 * DB_DRIVER is read from the environment at module load; the verification and
 * runtime both set it before entities are imported.
 */
const isPostgres = (process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'postgres';

export const DATETIME_TYPE: ColumnType = isPostgres ? 'timestamp' : 'datetime';
