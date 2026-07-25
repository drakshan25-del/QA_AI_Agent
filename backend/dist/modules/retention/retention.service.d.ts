import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ExecutionEvent, JobLogEntry } from '../../entities';
import { AuditService } from '../audit/audit.service';
export declare class RetentionService implements OnModuleInit, OnModuleDestroy {
    private readonly jobLogs;
    private readonly executionEvents;
    private readonly audit;
    private readonly config;
    private readonly logger;
    private timer;
    constructor(jobLogs: Repository<JobLogEntry>, executionEvents: Repository<ExecutionEvent>, audit: AuditService, config: ConfigService);
    private get policy();
    onModuleInit(): void;
    onModuleDestroy(): void;
    sweep(): Promise<Record<string, number>>;
    private sweepEvidence;
}
