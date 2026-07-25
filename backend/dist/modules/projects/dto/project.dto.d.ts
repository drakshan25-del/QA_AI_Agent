import { Role, Runner } from '../../../common/enums';
export declare class CreateProjectDto {
    name: string;
    description?: string;
    baseUrl?: string;
    allowedDomains?: string;
    repository?: string;
    environment?: string;
    llmModel?: string;
    llmTemperature?: number;
    runner?: Runner;
    tcZeroPad?: number;
}
export declare class UpdateProjectDto {
    name?: string;
    description?: string;
    baseUrl?: string;
    allowedDomains?: string;
    repository?: string;
    environment?: string;
    status?: 'active' | 'archived';
    llmModel?: string;
    llmTemperature?: number;
    runner?: Runner;
    tcZeroPad?: number;
}
export declare class AddMemberDto {
    userId: string;
    projectRole?: Role;
}
