import { CiService } from './ci.service';
import { DispatchWorkflowDto } from './dto/ci.dto';
import { AuthUser } from '../../common/decorators';
export declare class CiController {
    private readonly ci;
    constructor(ci: CiService);
    dispatch(dto: DispatchWorkflowDto, user: AuthUser, correlationId: string): Promise<Record<string, unknown>>;
    getRun(id: string, user: AuthUser): Promise<import("../../entities").ExecutionRun>;
    listRuns(projectId: string, user: AuthUser): Promise<import("../../entities").ExecutionRun[]>;
    importRun(id: string, body: {
        metrics?: Record<string, unknown>;
        status?: string;
    }, user: AuthUser, correlationId: string): Promise<import("../../entities").ExecutionRun>;
}
