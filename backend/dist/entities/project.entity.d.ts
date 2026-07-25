import { ProjectStatus, Runner } from '../common/enums';
export declare class Project {
    id: string;
    name: string;
    description: string;
    baseUrl: string;
    allowedDomains: string;
    repository: string;
    environment: string;
    status: ProjectStatus;
    llmModel: string;
    llmTemperature: number;
    runner: Runner;
    tcZeroPad: number;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
