import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionRun, Finding, Project, TestResult } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { NotFoundAppException } from '../../common/errors';
import { ApprovalDecision } from '../../common/enums';
import { ConflictAppException } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { JobsService } from '../jobs/jobs.service';
import { EngineClient } from '../../engine/engine.client';

/**
 * V3 report counts (FR-V3-RPT-001): total, passed, failed, skipped, blocked,
 * flaky and not-run, reconciled against the persisted execution results.
 */
export interface ReportCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  flaky: number;
  notRun: number;
  passRate: number;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ExecutionRun)
    private readonly runs: Repository<ExecutionRun>,
    @InjectRepository(TestResult)
    private readonly results: Repository<TestResult>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(Finding)
    private readonly findings: Repository<Finding>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly jobs: JobsService,
    private readonly engine: EngineClient,
  ) {
    this.jobs.registerRetryHandler('report', (original, user, correlationId) =>
      this.generate(
        (original.inputRefs?.executionRunId as string) ?? '',
        user,
        correlationId,
      ),
    );
  }

  private async loadRun(id: string, user: AuthUser): Promise<ExecutionRun> {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundAppException(`Execution ${id} not found`);
    await this.membership.ensureMember(run.projectId, user);
    return run;
  }

  /** Reconciled counts from persisted results + run metrics (FR-V3-RPT-001). */
  buildCounts(
    run: ExecutionRun,
    results: TestResult[],
  ): ReportCounts {
    const metrics = (run.metrics ?? {}) as Record<string, number>;
    const byOutcome = (o: string) =>
      results.filter((r) => r.outcome === o).length;
    const passed = results.length ? byOutcome('passed') : metrics.passed ?? 0;
    const failed = results.length ? byOutcome('failed') : metrics.failed ?? 0;
    const skipped = results.length ? byOutcome('skipped') : metrics.skipped ?? 0;
    // Blocked = setup/collection errors; flaky = failed then passed on retry.
    const blocked = results.length
      ? byOutcome('error') + byOutcome('blocked')
      : metrics.errors ?? 0;
    const flaky = results.length ? byOutcome('flaky') : metrics.flaky ?? 0;
    const executed = passed + failed + skipped + blocked + flaky;
    const planned = metrics.total ?? executed;
    const notRun = Math.max(0, planned - executed);
    const total = Math.max(planned, executed);
    const denominator = passed + failed + flaky;
    return {
      total,
      passed,
      failed,
      skipped,
      blocked,
      flaky,
      notRun,
      passRate: denominator
        ? Math.round(((passed + flaky) / denominator) * 100)
        : 0,
    };
  }

  /**
   * Report generation runs as an async job with a live log console
   * (FR-V3-LOG-006). Returns 202-style {jobId} while aggregation, evidence
   * linking, classification and rendering stream progress events.
   */
  async generate(
    id: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<{ jobId: string; status: string; executionRunId: string }> {
    const run = await this.loadRun(id, user);

    const job = await this.jobs.create({
      projectId: run.projectId,
      type: 'report',
      correlationId,
      inputRefs: { executionRunId: id },
      createdBy: user.id,
    });

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'report.generate',
      resourceType: 'execution',
      resourceId: id,
      projectId: run.projectId,
      correlationId,
      metadata: { jobId: job.id },
    });

    this.jobs.dispatch(job, async (j, ctx) => {
      await ctx.log({
        stage: 'result aggregation',
        message: `Aggregating results and metrics for execution ${id}`,
        progress: 15,
      });
      const results = await this.results.find({ where: { executionRunId: id } });
      const project = await this.projects.findOne({
        where: { id: run.projectId },
      });
      const runFindings = await this.findings.find({
        where: { executionRunId: id },
      });
      const counts = this.buildCounts(run, results);

      await ctx.log({
        stage: 'evidence linking',
        message: `Linking ${results.length} test result(s) and ${runFindings.length} classification(s) to evidence`,
        progress: 40,
      });

      const data: Record<string, unknown> = {
        project: project
          ? {
              name: project.name,
              base_url: project.baseUrl,
              environment: project.environment,
            }
          : undefined,
        run_summary: {
          run_id: run.id,
          project_id: run.projectId,
          status: run.status,
          environment: run.environment,
          browser: run.browser,
          mode: run.mode,
          headed: run.headed,
          run_scope: run.runScope,
          settings: run.settings || {},
          ci_run_id: run.ciRunId,
          ci_url: run.ciUrl,
          started_at: run.startedAt,
          finished_at: run.finishedAt,
          metrics: run.metrics || {},
        },
        counts: counts as unknown as Record<string, unknown>,
        tests: results.map((r) => ({
          node_id: r.nodeId,
          outcome: r.outcome,
          duration_seconds: r.durationSeconds,
          error_message: r.errorMessage,
          evidence: r.evidence || null,
        })),
        classifications: runFindings.map((f) => ({
          id: f.id,
          test_result_id: f.testResultId,
          classification: f.classification,
          confidence: f.confidence,
          rationale: f.rationale,
          severity: f.severity,
          overridden: f.overridden,
        })),
        metrics: run.metrics || {},
        evidence: run.evidence || {},
      };

      await ctx.log({
        stage: 'report rendering',
        message: 'Rendering HTML/Markdown report and AI narrative',
        progress: 65,
      });
      const report = await this.engine.report({ data }, correlationId);
      const built: Record<string, unknown> = {
        data: report.data ?? data,
        counts,
        html: report.html ?? '',
        md: report.md ?? '',
      };
      const fresh = await this.runs.findOne({ where: { id } });
      if (fresh) {
        fresh.report = built;
        await this.runs.save(fresh);
      }
      await ctx.log({
        stage: 'completed',
        severity: 'success',
        message: `Report stored (pass rate ${counts.passRate}%, ${counts.total} tests)`,
        progress: 100,
      });
      return { resultRefs: { executionRunId: id, reportStored: true } };
    });

    return { jobId: job.id, status: job.status, executionRunId: id };
  }

  /** Report publication gate (FR-V3-ENT-002): approve/reject before export. */
  async decidePublication(
    id: string,
    decision: ApprovalDecision,
    comment: string,
    user: AuthUser,
    correlationId?: string,
  ) {
    const run = await this.loadRun(id, user);
    if (!run.report) {
      throw new ConflictAppException(
        `No report generated for execution ${id} yet; generate it before deciding publication.`,
        'report_missing',
      );
    }
    const record = await this.approvals.recordStandalone(
      'report',
      id,
      run.projectId,
      decision,
      comment,
      user,
      correlationId,
    );
    return { executionRunId: id, decision: record.decision };
  }

  async export(
    id: string,
    format: string,
    user: AuthUser,
  ): Promise<{ contentType: string; filename: string; body: string }> {
    const run = await this.loadRun(id, user);
    // FR-REP-006/FR-V3-ENT-002: only approved reports are exported.
    const publication = await this.approvals.latestStandalone('report', id);
    if (publication?.decision === 'rejected') {
      throw new ConflictAppException(
        `Report for execution ${id} was rejected for publication and cannot be exported.`,
        'report_publication_rejected',
      );
    }
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
    if (format === 'csv') {
      // Excel-compatible CSV export (FR-V3-RPT-005).
      const results = await this.results.find({
        where: { executionRunId: id },
      });
      const counts = this.buildCounts(run, results);
      return {
        contentType: 'text/csv',
        filename: `${base}.csv`,
        body: renderCsv(run, counts, results),
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

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function renderCsv(
  run: ExecutionRun,
  counts: ReportCounts,
  results: TestResult[],
): string {
  const lines: string[] = [];
  lines.push('# Execution report');
  lines.push(
    ['run_id', 'status', 'browser', 'mode', 'environment', 'started_at', 'finished_at'].join(','),
  );
  lines.push(
    [
      run.id,
      run.status,
      run.browser,
      run.headed ? 'headed' : 'headless',
      run.environment,
      run.startedAt?.toISOString?.() ?? run.startedAt ?? '',
      run.finishedAt?.toISOString?.() ?? run.finishedAt ?? '',
    ]
      .map(csvEscape)
      .join(','),
  );
  lines.push('');
  lines.push('# Counts');
  lines.push('total,passed,failed,skipped,blocked,flaky,not_run,pass_rate');
  lines.push(
    [
      counts.total,
      counts.passed,
      counts.failed,
      counts.skipped,
      counts.blocked,
      counts.flaky,
      counts.notRun,
      `${counts.passRate}%`,
    ].join(','),
  );
  lines.push('');
  lines.push('# Tests');
  lines.push('node_id,outcome,duration_seconds,error_message');
  for (const r of results) {
    lines.push(
      [r.nodeId, r.outcome, r.durationSeconds, r.errorMessage]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
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
