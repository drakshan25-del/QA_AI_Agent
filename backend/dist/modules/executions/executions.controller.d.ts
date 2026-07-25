import { ExecutionsService } from './executions.service';
import { CreateExecutionDto } from './dto/execution.dto';
import { AuthUser } from '../../common/decorators';
export declare class ExecutionsController {
    private readonly executions;
    constructor(executions: ExecutionsService);
    create(dto: CreateExecutionDto, user: AuthUser, correlationId: string, idempotencyKey?: string): Promise<{
        id: string;
        status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out" | "passed" | "preparing" | "stopping" | "partially_passed" | "error";
        testPaths: string[];
        runScope: "failed" | "selected" | "all";
        browser: string;
        headed: boolean;
        settings: import("./executions.service").EffectiveSettings;
    }>;
    get(id: string, user: AuthUser): Promise<import("../../entities").ExecutionRun>;
    events(id: string, user: AuthUser, fromSeq?: string): Promise<import("../../entities").ExecutionEvent[]>;
    results(id: string, user: AuthUser): Promise<import("../../entities").TestResult[]>;
    logs(id: string, user: AuthUser, fromSeq?: string): Promise<import("../../entities").ExecutionLogEntry[]>;
    cancel(id: string, user: AuthUser, correlationId: string): Promise<{
        id: string;
        cancelled: boolean;
        status: "running" | "completed" | "failed" | "cancelled" | "timed_out" | "passed" | "preparing" | "partially_passed" | "error";
    }>;
    restart(id: string, user: AuthUser, correlationId: string): Promise<{
        id: string;
        status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out" | "passed" | "preparing" | "stopping" | "partially_passed" | "error";
        testPaths: string[];
        runScope: "failed" | "selected" | "all";
        browser: string;
        headed: boolean;
        settings: import("./executions.service").EffectiveSettings;
    }>;
    report(id: string, user: AuthUser): Promise<Record<string, unknown>>;
}
export declare class ProjectExecutionsController {
    private readonly executions;
    constructor(executions: ExecutionsService);
    list(projectId: string, user: AuthUser): Promise<import("../../entities").ExecutionRun[]>;
}
