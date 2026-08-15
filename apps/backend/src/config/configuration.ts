/**
 * Typed configuration loaded from the environment (V2_CONTRACT §6).
 * No secrets are hard-coded (SEC-002); everything comes from env.
 */
export interface AppConfig {
  port: number;
  corsOrigin: string;
  db: {
    driver: 'postgres' | 'sqlite';
    url: string;
    sqliteFile: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  seedAdmin: {
    email: string;
    password: string;
  };
  /** Platform owner: the one account allowed to enable/disable other accounts. */
  superowner: {
    email: string;
  };
  /** Key material for sealing stored secrets (cloud LLM API keys, SEC-002). */
  secretsKey: string;
  engine: {
    url: string;
    token: string;
    timeoutMs: number;
  };
  ollamaBaseUrl: string;
  githubToken: string;
  uploadDir: string;
  maxUploadBytes: number;
  jobs: {
    /** Hard job timeout → status `timed_out` (§23.7, FR-V3-LOG). */
    timeoutMs: number;
  };
  execution: {
    /** Max concurrent local execution runs (FR-V3-EXE-012). */
    maxConcurrent: number;
    /** Admin-defined limits for run settings (FR-V3-EXE-011). */
    maxTimeoutSeconds: number;
    maxRetries: number;
    maxWorkers: number;
    maxSlowMoMs: number;
  };
  retention: {
    /** Days to keep job logs / execution events / evidence; 0 = keep (FR-V3-ENT-011). */
    jobLogDays: number;
    executionEventDays: number;
    evidenceDays: number;
    sweepIntervalMinutes: number;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  db: {
    driver:
      (process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'postgres'
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
  superowner: {
    email: (process.env.SUPEROWNER_EMAIL || 'rakshandangol93@gmail.com')
      .toLowerCase()
      .trim(),
  },
  secretsKey: process.env.SECRETS_ENCRYPTION_KEY || '',
  engine: {
    url: process.env.ENGINE_URL || 'http://localhost:8100',
    token: process.env.ENGINE_TOKEN || '',
    // Local LLM generation (test cases for a document-derived requirement)
    // routinely needs several minutes; 120s cut real jobs off mid-flight.
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
    executionEventDays: parseInt(
      process.env.RETENTION_EXECUTION_EVENT_DAYS || '0',
      10,
    ),
    evidenceDays: parseInt(process.env.RETENTION_EVIDENCE_DAYS || '0', 10),
    sweepIntervalMinutes: parseInt(
      process.env.RETENTION_SWEEP_INTERVAL_MINUTES || '720',
      10,
    ),
  },
});
