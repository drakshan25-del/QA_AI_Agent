import { ApprovalStatus, ArtefactState, CiRunStatus, ExecutionStatus, JobStatus, ValidationStatus } from './enums';
type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;
export declare const JOB_TRANSITIONS: TransitionMap<JobStatus>;
export declare const EXECUTION_TRANSITIONS: TransitionMap<ExecutionStatus>;
export declare const VALIDATION_TRANSITIONS: TransitionMap<ValidationStatus>;
export declare const CI_RUN_TRANSITIONS: TransitionMap<CiRunStatus>;
export declare function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean;
export declare function assertTransition<S extends string>(map: TransitionMap<S>, entity: string, from: S, to: S): void;
export declare function isTerminalJobStatus(status: JobStatus): boolean;
export declare function isTerminalExecutionStatus(status: ExecutionStatus): boolean;
export declare function deriveArtefactState(entity: {
    approvalStatus: ApprovalStatus;
    approvalInvalidated?: boolean;
    status?: string;
    archived?: boolean;
}): ArtefactState;
export declare function outcomeFromMetrics(metrics: {
    passed?: number;
    failed?: number;
    errors?: number;
    total?: number;
}): Extract<ExecutionStatus, 'passed' | 'failed' | 'partially_passed'>;
export {};
