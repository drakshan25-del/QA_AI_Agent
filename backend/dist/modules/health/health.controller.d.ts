import { DataSource } from 'typeorm';
import { EngineClient } from '../../engine/engine.client';
export declare class HealthController {
    private readonly dataSource;
    private readonly engine;
    constructor(dataSource: DataSource, engine: EngineClient);
    health(): Promise<Record<string, unknown>>;
}
