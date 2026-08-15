/**
 * e2e environment: an isolated in-memory SQLite DB and test secrets, set
 * before the AppModule/ConfigModule loads. No engine is required for the
 * auth/projects flows exercised here.
 */
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.SEED_ADMIN_EMAIL = 'admin@example.com';
process.env.SEED_ADMIN_PASSWORD = 'admin12345';
process.env.ENGINE_URL = 'http://localhost:8100';
process.env.ENGINE_TOKEN = 'dev-engine-token';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.PORT = '0';
