import { GitService } from './git.service';
import { GitCommitDto } from './dto/git.dto';
import { AuthUser } from '../../common/decorators';
export declare class GitController {
    private readonly git;
    constructor(git: GitService);
    commit(projectId: string, dto: GitCommitDto, user: AuthUser, correlationId: string): Promise<Record<string, unknown>>;
}
