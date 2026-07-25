import { Repository } from 'typeorm';
import { ProjectSequence } from '../../entities';
export declare class SequencesService {
    private readonly repo;
    private static readonly MAX_ATTEMPTS;
    constructor(repo: Repository<ProjectSequence>);
    next(projectId: string, name: string, count?: number): Promise<number>;
    raiseTo(projectId: string, name: string, minimum: number): Promise<void>;
}
