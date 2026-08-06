import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators';
import { EngineClient } from '../../engine/engine.client';

/** GET /health → {api, database, engine, ollama} (§17). Public. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly engine: EngineClient,
  ) {}

  @Public()
  @Get()
  async health(): Promise<Record<string, unknown>> {
    let database = 'ok';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      database = 'error';
    }

    let engine = 'error';
    let ollama = 'unknown';
    try {
      const h = await this.engine.health();
      engine = (h.status as string) === 'ok' ? 'ok' : 'degraded';
      const ol = h.ollama as { available?: boolean } | undefined;
      ollama = ol?.available ? 'ok' : 'unavailable';
    } catch {
      engine = 'error';
      ollama = 'unknown';
    }

    const status =
      database === 'ok' && engine === 'ok' ? 'ok' : 'degraded';
    return { status, api: 'ok', database, engine, ollama };
  }
}
