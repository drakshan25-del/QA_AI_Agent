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
  engine: {
    url: string;
    token: string;
  };
  ollamaBaseUrl: string;
  githubToken: string;
  uploadDir: string;
  maxUploadBytes: number;
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
  engine: {
    url: process.env.ENGINE_URL || 'http://localhost:8100',
    token: process.env.ENGINE_TOKEN || '',
  },
  ollamaBaseUrl: process.env.QA_OLLAMA_BASE_URL || 'http://localhost:11434',
  githubToken: process.env.GITHUB_TOKEN || '',
  uploadDir: process.env.UPLOAD_DIR || './evidence',
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || '26214400', 10),
});
