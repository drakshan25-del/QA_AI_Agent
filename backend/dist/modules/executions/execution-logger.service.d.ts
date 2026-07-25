import { Repository } from 'typeorm';
import { ExecutionLogEntry } from '../../entities';
import { ExecutionLogLevel, ExecutionStage } from '../../common/enums';
import { EventsService } from '../events/events.service';
export interface ExecutionLogContext {
    runId: string;
    projectId: string;
    correlationId?: string;
}
export interface ExecutionLogInput {
    level?: ExecutionLogLevel;
    stage?: string;
    message: string;
    progress?: number | null;
    testCaseId?: string;
    testName?: string;
    meta?: Record<string, unknown>;
}
export interface ScopedExecutionLogger {
    stage(stage: ExecutionStage, message?: string): Promise<void>;
    setStage(stage: ExecutionStage): void;
    info(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
    debug(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
    warning(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
    error(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
    success(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
    pass(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
    fail(message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
    progress(current: number, total: number, message: string, extra?: Partial<ExecutionLogInput>): Promise<void>;
    readonly currentStage: string;
}
export declare class ExecutionLoggerService {
    private readonly logs;
    private readonly events;
    private readonly logger;
    private readonly seqByRun;
    private readonly seeded;
    private readonly seeding;
    constructor(logs: Repository<ExecutionLogEntry>, events: EventsService);
    forRun(ctx: ExecutionLogContext): ScopedExecutionLogger;
    write(ctx: ExecutionLogContext, entry: ExecutionLogInput): Promise<void>;
    fetch(runId: string, fromSeq?: number): Promise<ExecutionLogEntry[]>;
    release(runId: string): void;
    private nextSeq;
}
