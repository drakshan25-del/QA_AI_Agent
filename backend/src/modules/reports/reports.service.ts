import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionRun, TestResult } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ExecutionRun)
    private readonly runs: Repository<ExecutionRun>,
    @InjectRepository(TestResult)
    private readonly results: Repository<TestResult>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly engine: EngineClient,
  ) {}

  private async loadRun(id: string, user: AuthUser): Promise<ExecutionRun> {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundAppException(`Execution ${id} not found`);
    await this.membership.ensureMember(run.projectId, user);
    return run;
  }

  async generate(
    id: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
    const run = await this.loadRun(id, user);
    const results = await this.results.find({ where: { executionRunId: id } });

    const data: Record<string, unknown> = {
      run_summary: {
        run_id: run.id,
        project_id: run.projectId,
        status: run.status,
        environment: run.environment,
        browser: run.browser,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        metrics: run.metrics || {},
      },
      tests: results.map((r) => ({
        node_id: r.nodeId,
        outcome: r.outcome,
        duration_seconds: r.durationSeconds,
        error_message: r.errorMessage,
      })),
      metrics: run.metrics || {},
    };

    const report = await this.engine.report({ data }, correlationId);
    const built: Record<string, unknown> = {
      data: report.data ?? data,
      html: report.html ?? '',
      md: report.md ?? '',
    };
    run.report = built;
    await this.runs.save(run);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'report.generate',
      resourceType: 'execution',
      resourceId: id,
      projectId: run.projectId,
      correlationId,
    });
    return built;
  }

  async export(
    id: string,
    format: string,
    user: AuthUser,
  ): Promise<{ contentType: string; filename: string; body: string }> {
    const run = await this.loadRun(id, user);
    const report = run.report;
    const base = `execution-${id}-report`;

    if (format === 'json') {
      return {
        contentType: 'application/json',
        filename: `${base}.json`,
        body: JSON.stringify(report ?? { message: 'report not generated' }, null, 2),
      };
    }
    if (format === 'junit') {
      const results = await this.results.find({
        where: { executionRunId: id },
      });
      return {
        contentType: 'application/xml',
        filename: `${base}.junit.xml`,
        body: renderJunit(id, results),
      };
    }
    if (format === 'html') {
      const html =
        (report?.html as string) ||
        `<html><body><h1>Execution ${id}</h1><pre>${escapeHtml(
          JSON.stringify(run.metrics || {}, null, 2),
        )}</pre></body></html>`;
      return { contentType: 'text/html', filename: `${base}.html`, body: html };
    }
    // pdf fallback → HTML payload (documented gap: no PDF renderer in this tier).
    const html =
      (report?.html as string) || `<html><body><h1>Execution ${id}</h1></body></html>`;
    return {
      contentType: 'application/pdf',
      filename: `${base}.pdf`,
      body: html,
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderJunit(runId: string, results: TestResult[]): string {
  const failures = results.filter((r) => r.outcome === 'failed').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  const cases = results
    .map((r) => {
      const inner =
        r.outcome === 'failed'
          ? `<failure message="${escapeHtml(r.errorMessage || 'failed')}"/>`
          : r.outcome === 'skipped'
            ? '<skipped/>'
            : '';
      return `    <testcase name="${escapeHtml(r.nodeId)}" time="${r.durationSeconds}">${inner}</testcase>`;
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuite name="run-${runId}" tests="${results.length}" failures="${failures}" skipped="${skipped}">\n` +
    `${cases}\n</testsuite>\n`
  );
}
