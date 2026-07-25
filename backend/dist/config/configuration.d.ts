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
        timeoutMs: number;
    };
    ollamaBaseUrl: string;
    githubToken: string;
    uploadDir: string;
    maxUploadBytes: number;
    jobs: {
        timeoutMs: number;
    };
    execution: {
        maxConcurrent: number;
        maxTimeoutSeconds: number;
        maxRetries: number;
        maxWorkers: number;
        maxSlowMoMs: number;
    };
    retention: {
        jobLogDays: number;
        executionEventDays: number;
        evidenceDays: number;
        sweepIntervalMinutes: number;
    };
}
declare const _default: () => AppConfig;
export default _default;
