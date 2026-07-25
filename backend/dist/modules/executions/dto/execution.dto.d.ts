import { RunScope } from '../../../common/enums';
export declare class ExecutionSettingsDto {
    timeoutSeconds?: number;
    retries?: number;
    workers?: number;
    slowMoMs?: number;
    screenshotMode?: 'on-failure' | 'every-test' | 'off';
    video?: boolean;
}
export declare class CreateExecutionDto {
    projectId: string;
    automationIds?: string[];
    testPaths?: string[];
    browser?: string;
    headed?: boolean;
    environment?: string;
    runScope?: RunScope;
    settings?: ExecutionSettingsDto;
    markers?: string;
}
