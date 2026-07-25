import { JobsService } from './jobs.service';
import { AuthUser } from '../../common/decorators';
export declare class JobsController {
    private readonly jobs;
    constructor(jobs: JobsService);
    get(id: string, user: AuthUser): Promise<import("../../entities").Job>;
    logs(id: string, user: AuthUser, fromSeq?: string): Promise<import("../../entities").JobLogEntry[]>;
    cancel(id: string, user: AuthUser): Promise<import("../../entities").Job>;
    retry(id: string, user: AuthUser, correlationId: string): Promise<{
        jobId: string;
        status: string;
        retryOfJobId: string;
    }>;
    list(projectId: string): Promise<import("../../entities").Job[]>;
}
