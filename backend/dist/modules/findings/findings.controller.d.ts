import { FindingsService } from './findings.service';
import { ClassifyDto, OverrideFindingDto } from './dto/finding.dto';
import { AuthUser } from '../../common/decorators';
export declare class FindingsController {
    private readonly findings;
    constructor(findings: FindingsService);
    classify(id: string, dto: ClassifyDto, user: AuthUser, correlationId: string): Promise<import("../../entities").Finding>;
    override(id: string, dto: OverrideFindingDto, user: AuthUser, correlationId: string): Promise<import("../../entities").Finding>;
    defectDraft(id: string, user: AuthUser, correlationId: string): Promise<Record<string, unknown>>;
}
