import { ConfigService } from '@nestjs/config';
export interface EngineSseEvent {
    seq: number;
    type: string;
    payload: Record<string, unknown>;
}
export declare class EngineClient {
    private readonly config;
    private readonly logger;
    private readonly http;
    private readonly baseUrl;
    private readonly token;
    constructor(config: ConfigService);
    private headers;
    private post;
    private wrap;
    health(): Promise<Record<string, unknown>>;
    parse(files: {
        filename: string;
        category: string;
        contentBase64: string;
    }[], correlationId?: string): Promise<{
        documents: EngineParsedDocument[];
        schema_version?: string;
    }>;
    analyse(body: {
        requirementId?: string;
        text: string;
        acceptanceCriteria?: string[];
        model?: string;
        temperature?: number;
    }, correlationId?: string, idempotencyKey?: string): Promise<Record<string, unknown>>;
    testPlan(body: {
        projectName: string;
        baseUrl?: string;
        requirements?: unknown[];
        analyses?: unknown[];
        model?: string;
        temperature?: number;
    }, correlationId?: string, idempotencyKey?: string): Promise<Record<string, unknown>>;
    testCases(body: {
        requirement: unknown;
        analysis?: unknown;
        minCases?: number;
        model?: string;
        temperature?: number;
    }, correlationId?: string, idempotencyKey?: string): Promise<Record<string, unknown>>;
    automation(body: {
        testCases: unknown[];
        baseUrl?: string;
        pageObjectsSummary?: string;
        model?: string;
        temperature?: number;
    }, correlationId?: string, idempotencyKey?: string): Promise<Record<string, unknown>>;
    validate(body: {
        files: {
            path: string;
            content: string;
        }[];
        allowedDomains?: string[];
        runCollection?: boolean;
    }, correlationId?: string): Promise<Record<string, unknown>>;
    executionPlan(body: {
        testCases: unknown[];
        baseUrl?: string;
    }, correlationId?: string): Promise<Record<string, unknown>>;
    classify(body: {
        test: unknown;
        context?: unknown;
        model?: string;
        temperature?: number;
    }, correlationId?: string): Promise<Record<string, unknown>>;
    report(body: {
        data: Record<string, unknown>;
    }, correlationId?: string): Promise<Record<string, unknown>>;
    execute(body: {
        runId: string;
        files?: {
            path: string;
            content: string;
        }[];
        testPaths?: string[];
        browser?: string;
        headed?: boolean;
        environment?: string;
        allowedDomains?: string;
        targetBaseUrl?: string;
        markers?: string;
        timeoutSeconds?: number;
        retries?: number;
        workers?: number;
        slowMoMs?: number;
        screenshotMode?: string;
        video?: boolean;
    }, correlationId?: string, idempotencyKey?: string): Promise<{
        runId: string;
        status: string;
        eventsUrl: string;
    }>;
    renderPdf(html: string, correlationId?: string): Promise<{
        pdfBase64: string;
    }>;
    cancelExecution(runId: string, correlationId?: string): Promise<{
        runId: string;
        cancelled: boolean;
    }>;
    streamRunEvents(runId: string, onEvent: (event: EngineSseEvent) => void | Promise<void>, opts?: {
        fromSeq?: number;
        correlationId?: string;
        signal?: AbortSignal;
    }): Promise<void>;
}
export interface EngineParsedDocument {
    filename: string;
    category: string;
    kind: string;
    text?: string;
    segments: {
        page_or_sheet: string;
        row_or_section: string;
        content: string;
        metadata?: Record<string, unknown>;
        inclusion_status?: string;
    }[];
    parse_status: string;
    message?: string;
    metadata?: Record<string, unknown>;
}
