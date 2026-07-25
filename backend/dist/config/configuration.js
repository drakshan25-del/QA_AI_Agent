"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    port: parseInt(process.env.PORT || '4000', 10),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    db: {
        driver: (process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'postgres'
            ? 'postgres'
            : 'sqlite',
        url: process.env.DATABASE_URL || 'postgres://qa:qa@localhost:5432/qa_v2',
        sqliteFile: process.env.SQLITE_FILE || './qa_v2.dev.sqlite',
    },
    jwt: {
        accessSecret: process.env.JWT_ACCESS_SECRET || '',
        refreshSecret: process.env.JWT_REFRESH_SECRET || '',
        accessTtl: process.env.JWT_ACCESS_TTL || '15m',
        refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    },
    seedAdmin: {
        email: process.env.SEED_ADMIN_EMAIL || '',
        password: process.env.SEED_ADMIN_PASSWORD || '',
    },
    engine: {
        url: process.env.ENGINE_URL || 'http://localhost:8100',
        token: process.env.ENGINE_TOKEN || '',
        timeoutMs: parseInt(process.env.ENGINE_TIMEOUT_MS || '600000', 10),
    },
    ollamaBaseUrl: process.env.QA_OLLAMA_BASE_URL || 'http://localhost:11434',
    githubToken: process.env.GITHUB_TOKEN || '',
    uploadDir: process.env.UPLOAD_DIR || './evidence',
    maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || '26214400', 10),
    jobs: {
        timeoutMs: parseInt(process.env.JOB_TIMEOUT_MS || '1800000', 10),
    },
    execution: {
        maxConcurrent: parseInt(process.env.EXEC_MAX_CONCURRENT || '1', 10),
        maxTimeoutSeconds: parseInt(process.env.EXEC_MAX_TIMEOUT_SECONDS || '1800', 10),
        maxRetries: parseInt(process.env.EXEC_MAX_RETRIES || '3', 10),
        maxWorkers: parseInt(process.env.EXEC_MAX_WORKERS || '4', 10),
        maxSlowMoMs: parseInt(process.env.EXEC_MAX_SLOWMO_MS || '2000', 10),
    },
    retention: {
        jobLogDays: parseInt(process.env.RETENTION_JOB_LOG_DAYS || '0', 10),
        executionEventDays: parseInt(process.env.RETENTION_EXECUTION_EVENT_DAYS || '0', 10),
        evidenceDays: parseInt(process.env.RETENTION_EVIDENCE_DAYS || '0', 10),
        sweepIntervalMinutes: parseInt(process.env.RETENTION_SWEEP_INTERVAL_MINUTES || '720', 10),
    },
});
//# sourceMappingURL=configuration.js.map