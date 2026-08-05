import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  GeneratedArtifact,
  GenerationRun,
  Project,
  TestCase,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../../common/errors';
import { contentHash } from '../../common/hash';
import { ApprovalDecision } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import {
  LocatorStorageService,
  ResolvedLocator,
} from '../ui-scanner/locator-storage.service';
import { LocatorUsageService } from '../ui-scanner/locator-usage.service';
import { GenerateAutomationDto } from './dto/automation.dto';
import { LocatorResolutionService } from './locator-resolution.service';
import { ResolvedAutomationLocator } from './locator-resolution.types';
import { StepLocatorReference } from '../../entities';

@Injectable()
export class AutomationService {
  constructor(
    @InjectRepository(GeneratedArtifact)
    private readonly artifacts: Repository<GeneratedArtifact>,
    @InjectRepository(TestCase) private readonly cases: Repository<TestCase>,
    @InjectRepository(GenerationRun)
    private readonly runs: Repository<GenerationRun>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly membership: MembershipService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly jobs: JobsService,
    private readonly approvals: ApprovalsService,
    private readonly engine: EngineClient,
    private readonly locators: LocatorStorageService,
    private readonly resolution: LocatorResolutionService,
    private readonly locatorUsage: LocatorUsageService,
  ) {
    this.jobs.registerRetryHandler('automation', (original, user, correlationId) =>
      this.generate(
        original.projectId,
        {
          testCaseIds: (original.inputRefs?.testCaseIds as string[]) ?? [],
          draftPreview: !!original.inputRefs?.draftPreview,
        },
        user,
        correlationId,
      ),
    );
    this.jobs.registerRetryHandler('validation', (original, user, correlationId) =>
      this.validate(
        (original.inputRefs?.artifactId as string) ?? '',
        user,
        correlationId,
      ),
    );
  }

  async generate(
    projectId: string,
    dto: GenerateAutomationDto,
    user: AuthUser,
    correlationId?: string,
    idempotencyKey?: string,
  ) {
    await this.membership.ensureMember(projectId, user);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundAppException(`Project ${projectId} not found`);

    const cases = await this.cases.find({
      where: { projectId, id: In(dto.testCaseIds) },
    });
    if (!cases.length) {
      throw new NotFoundAppException('No matching test cases found');
    }

    // Gate: approved cases only, unless a draft preview (FR-TC-009).
    if (!dto.draftPreview) {
      const unapproved = cases.filter((c) => c.approvalStatus !== 'approved');
      if (unapproved.length) {
        throw new ConflictAppException(
          `Cannot generate automation: ${unapproved.length} of ${cases.length} ` +
            `test cases are not approved. Approve them or pass draftPreview=true.`,
          'approval_required',
          { unapprovedTestCaseIds: unapproved.map((c) => c.id) },
        );
      }
    }

    const job = await this.jobs.create({
      projectId,
      type: 'automation',
      correlationId,
      idempotencyKey,
      inputRefs: { testCaseIds: dto.testCaseIds, draftPreview: !!dto.draftPreview },
      createdBy: user.id,
    });

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'automation.generate',
      resourceType: 'job',
      resourceId: job.id,
      projectId,
      correlationId,
      metadata: { testCases: cases.length, draftPreview: !!dto.draftPreview },
    });

    this.jobs.dispatch(job, async (j, ctx) => {
      // The project's `runner` field offers `playwright-test`, but generation,
      // validation and execution are pytest + sync-Playwright Python end to
      // end. Saying so here is better than quietly producing Python for a
      // project whose settings promise TypeScript.
      const pytestOnly = project.runner !== 'pytest';
      await ctx.log({
        stage: 'framework selection',
        message: pytestOnly
          ? `This project is configured for the "${project.runner}" runner, but ` +
            'automation is generated, validated and executed as pytest + ' +
            'sync-Playwright Python. Generating pytest files; set the project ' +
            'runner to "pytest" to match what actually runs.'
          : `Generating pytest Playwright automation for ${cases.length} approved test case(s)`,
        severity: pytestOnly ? 'warning' : 'info',
        progress: 10,
      });
      await ctx.checkpoint();

      // Locators come from the UI Scanner's library, not from the model's
      // imagination (FR-UIS-025). Every test step is matched to a scanned
      // element and bound to a locator that was validated against the live
      // application *before* the model is called; the model receives those
      // bindings and is forbidden from producing any other selector.
      await ctx.log({
        stage: 'locator resolution',
        message: `Matching ${cases.length} test case(s) against the project's scanned locator library`,
        progress: 14,
      });
      const resolutions = await this.resolution.resolveBatch(
        projectId,
        cases,
        user,
        {
          correlationId,
          // A generation request must not silently open a browser for a full
          // rescan; stale locators are re-validated, missing ones are marked.
          revalidate: true,
          allowTargetedRescan: false,
          isCancelled: async () => {
            await ctx.checkpoint();
            return false;
          },
        },
      );

      const resolvedSteps = resolutions.flatMap((r) => r.resolvedSteps);
      const unresolvedSteps = resolutions.flatMap((r) => r.unresolvedSteps);
      // The rest of the project's validated library travels with the resolved
      // steps. The step binding is what the agent should follow, but a locator
      // the scanner already validated must never be treated as invented just
      // because the matcher chose a different one for that step (FR-UIS-025 §2).
      const library = await this.locators.approvedForProject(projectId);
      const boundLocatorIds = new Set(resolvedSteps.map((s) => s.locatorId));
      const unboundLibrary = library.filter((l) => !boundLocatorIds.has(l.id));
      const revalidated = new Set(
        resolutions.flatMap((r) => r.revalidatedLocatorIds),
      ).size;
      for (const warning of new Set(resolutions.flatMap((r) => r.warnings))) {
        await ctx.log({ stage: 'locator resolution', message: warning, severity: 'warning' });
      }
      await ctx.log({
        stage: 'locator resolution',
        severity: 'info',
        message:
          `${resolvedSteps.length} step(s) matched directly to a scanned locator` +
          (revalidated ? `, ${revalidated} re-validated against the live page` : '') +
          (unresolvedSteps.length
            ? `; ${unresolvedSteps.length} step(s) will be bound from the project's ` +
              `${unboundLibrary.length + resolvedSteps.length} approved locator(s) during generation`
            : ''),
        progress: 22,
        meta: {
          resolved: resolvedSteps.length,
          unresolved: unresolvedSteps.length,
          revalidated,
        },
      });
      await ctx.checkpoint();

      await ctx.log({
        stage: 'file generation',
        message: `Creating page objects and assertions with ${project.llmModel || 'the default model'}, using only resolved UI Scanner locators`,
        progress: 25,
      });
      const output = await this.engine.automation(
        {
          testCases: cases.map((c) => ({
            id: c.id,
            case_key: c.caseKey,
            title: c.title,
            steps: c.steps ?? [],
            expected_results: c.expectedResults ?? [],
            test_data: c.testData ?? {},
            preconditions: c.preconditions ?? [],
          })),
          baseUrl: project.baseUrl,
          pageObjectsSummary: '',
          // The resolution contract (§8): per-step, machine-readable, with the
          // locator's identity and version attached.
          resolvedSteps: resolvedSteps.map(toEngineStep),
          // Page-level entries: validated, but not bound to a step.
          approvedLocators: unboundLibrary.map((l) => ({
            locator_id: l.id,
            locator_version: l.version,
            element_name: l.elementName,
            role: l.role,
            page: l.pageUrlPattern,
            strategy: l.strategy,
            expression: l.pythonExpression || l.expression,
            confidence: l.confidenceScore,
          })),
          unresolvedSteps: unresolvedSteps.map((s) => ({
            test_step_id: s.testStepId,
            test_case_id: s.testCaseId,
            test_step: s.testStep,
            reason: s.reason,
            suggested_action: s.suggestedAction,
          })),
          locatorComments: true,
          model: project.llmModel || undefined,
          temperature: project.llmTemperature,
        },
        correlationId,
        idempotencyKey,
      );
      await ctx.log({
        stage: 'formatting',
        message: 'Generated files returned; formatting and persisting artefacts',
        progress: 80,
      });

      const run = await this.runs.save(
        this.runs.create({
          projectId,
          kind: 'automation',
          jobId: job.id,
          model: project.llmModel,
          temperature: project.llmTemperature,
          contentHash: contentHash(output),
          status: 'completed',
        }),
      );

      const files = (output.files as Record<string, unknown>[]) || [];
      const artifactIds: string[] = [];
      const references: Omit<StepLocatorReference, 'id' | 'createdAt'>[] = [];

      /** Whether a generated file contains a step's locator verbatim. */
      const contains = (
        content: string,
        step: ResolvedAutomationLocator,
      ): boolean =>
        Boolean(
          (step.pythonExpression && content.includes(step.pythonExpression)) ||
            (step.expression && content.includes(step.expression)),
        );

      // The agent is asked for test-case ids and sometimes answers with case
      // keys ("TC-001") instead. Left unmapped, a file claims cases that do
      // not exist: its unresolved steps match nothing, it is marked "no review
      // required", and execution cannot attribute its results either.
      const caseById = new Map(cases.map((c) => [c.id, c]));
      const caseByKey = new Map<string, TestCase>();
      for (const c of cases) {
        if (c.caseKey) caseByKey.set(c.caseKey.toLowerCase(), c);
        if (c.humanId) caseByKey.set(c.humanId.toLowerCase(), c);
      }
      const resolveCaseIds = (declared: string[]): string[] => [
        ...new Set(
          declared
            .map(
              (value) =>
                caseById.get(value)?.id ??
                caseByKey.get(String(value).toLowerCase())?.id,
            )
            .filter((id): id is string => !!id),
        ),
      ];

      // Counted across the emitted files, so the job reports what was
      // generated rather than what the matcher predicted.
      let totalUnmatchedNotes = 0;
      const unmatchedStepIds = new Set<string>();

      for (const f of files) {
        const content = (f.content as string) || '';
        const fileCaseIds = resolveCaseIds((f.test_case_ids as string[]) || []);
        // Attribution is by *content*, not by test case: when the generator
        // emits a Page Object Model the locators live in the page object,
        // whose `test_case_ids` is empty by definition. Binding by test case
        // alone would record no traceability at all for a POM suite.
        const present = resolvedSteps.filter((s) => contains(content, s));
        // The unresolved steps belong to the test file that covers their case;
        // a page object never carries a review marker of its own.
        //
        // A test file that declares no test cases at all cannot be shown to be
        // clean of them, so it inherits the whole run's unresolved steps. That
        // is not pedantry: a file whose `test_case_ids` came back empty was
        // marked "no review required" and executed, and it turned out to
        // contain nothing but invented selectors.
        const isPageObject = ((f.kind as string) || 'test_file') === 'page_object';
        // What matters is what the generator actually produced, not what the
        // pre-generation matcher predicted. A step the matcher could not bind
        // is routinely bound afterwards from the approved locator library —
        // reporting the matcher's guess flagged clean, runnable files as
        // "review required" and blocked them from executing (FR-UIS-025 §2).
        const unmatchedNotes = countUnmatchedNotes(content);
        const predictedUnresolved = isPageObject
          ? []
          : fileCaseIds.length
            ? unresolvedSteps.filter((s) => fileCaseIds.includes(s.testCaseId))
            : unresolvedSteps;
        // Keep only the steps the generated file genuinely left unbound.
        const fileUnresolved =
          unmatchedNotes === 0
            ? []
            : predictedUnresolved.filter((s) => contentMentionsStep(content, s.testStep));
        // The result the Code tab shows, computed from this file's own content.
        const locatorValidation = locatorValidationOf(present.length, unmatchedNotes);

        totalUnmatchedNotes += unmatchedNotes;
        if (unmatchedNotes > 0) {
          for (const step of fileUnresolved) unmatchedStepIds.add(step.testStepId);
        }

        const saved = await this.artifacts.save(
          this.artifacts.create({
            projectId,
            generationRunId: run.id,
            testCaseIds: fileCaseIds.length ? fileCaseIds : dto.testCaseIds,
            path: (f.path as string) || 'generated_test.py',
            kind: (f.kind as string) || 'test_file',
            content,
            diff: '',
            traceability: {
              testCaseIds: fileCaseIds,
              notes: (output.notes as string) || '',
              // Kept in the artefact for the Code tab; the authoritative copy
              // is the `generated_step_locator_refs` rows written below.
              locatorUsage: present.map(toUsageEntry),
              resolvedStepCount: present.length,
              // Diagnostics only: these never block approval or execution.
              unmatchedSteps: fileUnresolved,
              unmatchedStepCount: unmatchedNotes,
              locatorValidation,
              scannedLocatorsAvailable: resolvedSteps.length,
            },
            contentHash: contentHash(content),
            version: 1,
            status: 'active',
            validationStatus: 'pending',
            approvalStatus: 'pending',
            schemaVersion: (output.schema_version as string) || 'v1',
            createdBy: user.id,
          }),
        );
        artifactIds.push(saved.id);

        // Page objects hold the locators; test files consume them. Both are
        // traceable, so a locator change can find every dependent file.
        for (const step of present) {
          references.push(toReference(step, run.id, saved.id));
        }
        // A library locator the agent used without a step binding is traced
        // too — otherwise a locator change could not find the file that
        // depends on it just because the matcher never picked it.
        for (const locator of unboundLibrary) {
          const expression = locator.pythonExpression || locator.expression;
          if (!expression || !content.includes(expression)) continue;
          references.push(toLibraryReference(locator, projectId, run.id, saved.id));
        }
      }

      // How many distinct scanned locators actually made it into the emitted
      // code. A step the generator dropped is not counted as used, however
      // well it resolved — the metric describes the suite, not the plan.
      const usedLocators = new Set(references.map((r) => r.locatorId)).size;

      // §9: one bulk write, and the generation-side usage metrics with it.
      if (references.length) {
        await this.locatorUsage.recordGeneration(projectId, references);
      }

      // A gap in locator coverage is a diagnostic. Approval of a locator is
      // final and generation is never sent back for review, so this only
      // decides what the job reports — never whether the suite may run (§5).
      const hasUnmatchedSteps = totalUnmatchedNotes > 0;
      await ctx.log({
        stage: 'traceability',
        severity: hasUnmatchedSteps ? 'warning' : usedLocators ? 'success' : 'info',
        message: usedLocators
          ? `${usedLocators} generated interaction(s) traced to UI Scanner locators` +
            (hasUnmatchedSteps
              ? `; ${unresolvedSteps.length} step(s) require locator review before this suite can be considered execution-ready`
              : '')
          : 'No UI Scanner locator appears in the generated code — every UI step ' +
            'requires review before execution',
        progress: 92,
        meta: {
          references: references.length,
          unmatched: unmatchedStepIds.size,
          boundFromLibrary: Math.max(0, unresolvedSteps.length - unmatchedStepIds.size),
        },
      });

      this.events.emit({
        type: 'automation.ready',
        projectId,
        jobId: job.id,
        correlationId,
        payload: { artifactIds, count: artifactIds.length, hasUnmatchedSteps },
      });

      return {
        resultRefs: {
          artifactIds,
          generationRunId: run.id,
          scannedLocatorsUsed: usedLocators,
          unmatchedStepIds: [...unmatchedStepIds],
          hasUnmatchedSteps,
        },
        readyEvent: {
          type: 'automation.ready' as const,
          payload: { artifactIds, count: artifactIds.length, hasUnmatchedSteps },
        },
        // A gap is reported, not enforced: the suite still runs (§5).
        warnings: hasUnmatchedSteps
          ? [
              `${unmatchedStepIds.size || totalUnmatchedNotes} test step(s) had no ` +
                `approved UI Scanner locator and were left out of the generated ` +
                `test. Scan the page they act on to cover them.`,
            ]
          : [],
      };
    });

    return { jobId: job.id, status: job.status };
  }

  async getOne(id: string, user: AuthUser): Promise<GeneratedArtifact> {
    const art = await this.artifacts.findOne({ where: { id } });
    if (!art) throw new NotFoundAppException(`Automation artifact ${id} not found`);
    await this.membership.ensureMember(art.projectId, user);
    return art;
  }

  /**
   * Save an in-place edit of a generated script (editable code editor).
   *
   * The edited code is untrusted until re-checked, so saving resets the
   * artefact to Draft: validation returns to `pending` and any prior approval
   * is invalidated (FR-VAL-007 — a change to generated code requires
   * revalidation and reapproval before it can execute). The content hash is
   * recomputed and the version incremented so the latest edit is the one that
   * materialises at execution time (AC-004/AC-005). A no-op edit (identical
   * content) is returned unchanged so re-saving does not churn the version.
   */
  async updateContent(
    id: string,
    content: string,
    user: AuthUser,
    correlationId?: string,
  ): Promise<GeneratedArtifact> {
    const art = await this.getOne(id, user);
    if (art.status !== 'active') {
      throw new ConflictAppException(
        `Automation ${id} is ${art.status} and cannot be edited.`,
        'invalid_state_transition',
        { artifactId: id, status: art.status },
      );
    }
    if (content === art.content) {
      return art; // nothing changed — do not bump version or invalidate
    }

    // Persist the new content first; edited code is unvalidated again
    // (FR-VAL-007). Approval invalidation is delegated to the canonical
    // upstream-modified path below, which reads the freshly-saved row.
    art.content = content;
    art.contentHash = contentHash(content);
    art.version += 1;
    art.diff = '';
    art.validationStatus = 'pending';
    art.validationReport = null;
    await this.artifacts.save(art);

    // If it had been approved, reopen the approval gate, mark prior approval
    // records invalidated and emit approval.updated (mirrors any upstream
    // change to generated code, FR-VAL-007).
    await this.approvals.onUpstreamModified(
      'automation',
      id,
      user,
      correlationId,
    );

    const updated = await this.getOne(id, user);

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'automation.edit',
      resourceType: 'automation',
      resourceId: id,
      projectId: updated.projectId,
      correlationId,
      metadata: {
        version: updated.version,
        contentHash: updated.contentHash,
        revalidationRequired: true,
        approvalInvalidated: updated.approvalInvalidated,
      },
    });

    // Nudge any open Automation pages to refetch (FR-BE-004).
    this.events.emit({
      type: 'automation.ready',
      projectId: updated.projectId,
      correlationId,
      payload: { artifactIds: [id], count: 1, reason: 'edited' },
    });

    return updated;
  }

  /**
   * The scanned locators one generated file was built from (§9, §10).
   *
   * Read from the persisted traceability rows rather than from the artefact's
   * embedded copy, so the Automation Code tab shows the authoritative chain —
   * including the locator's current validation status and version — even after
   * the locator has been re-validated since generation.
   *
   * A test file that delegates to a Page Object Model contains no locator of
   * its own; its locators live in the page object generated alongside it. When
   * the file has no references, the generation run's are returned instead, so
   * the reviewer still sees the chain behind the code in front of them — each
   * row carries the `generatedFileId` it really belongs to.
   */
  async locatorReferences(
    id: string,
    user: AuthUser,
  ): Promise<StepLocatorReference[]> {
    const art = await this.getOne(id, user);
    const own = await this.locatorUsage.forArtifact(art.projectId, art.id);
    if (own.length || !art.generationRunId) return own;
    return this.locatorUsage.forGeneration(art.projectId, art.generationRunId);
  }

  async listByProject(
    projectId: string,
    user: AuthUser,
  ): Promise<GeneratedArtifact[]> {
    await this.membership.ensureMember(projectId, user);
    return this.artifacts.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Validation runs as an async job with a live log console
   * (FR-V3-LOG-005, §23.7 validation state machine).
   */
  async validate(id: string, user: AuthUser, correlationId?: string) {
    const art = await this.getOne(id, user);
    const project = await this.projects.findOne({
      where: { id: art.projectId },
    });

    const job = await this.jobs.create({
      projectId: art.projectId,
      type: 'validation',
      correlationId,
      inputRefs: { artifactId: id, path: art.path },
      createdBy: user.id,
    });

    await this.audit.record({
      actor: user.email,
      actorId: user.id,
      action: 'automation.validate',
      resourceType: 'automation',
      resourceId: id,
      projectId: art.projectId,
      correlationId,
      metadata: { jobId: job.id },
    });

    art.validationStatus = 'running';
    await this.artifacts.save(art);

    this.jobs.dispatch(job, async (j, ctx) => {
      await ctx.log({
        stage: 'syntax',
        message: `Validating ${art.path}: Python syntax, imports and Pytest collection`,
        progress: 15,
      });
      const report = await this.engine.validate(
        {
          files: [{ path: art.path, content: art.content }],
          allowedDomains: (
            project?.allowedDomains || 'localhost,127.0.0.1'
          ).split(','),
          runCollection: true,
        },
        correlationId,
      );
      await ctx.log({
        stage: 'policy scan',
        message:
          'Checking forbidden operations, hard-coded secrets, locator quality and the domain allow-list',
        progress: 70,
      });

      const passed = report.passed === true;
      const findings = (report.findings as { severity?: string }[]) || [];
      const warnings = findings.filter(
        (f) => (f.severity || '').toLowerCase() === 'warning',
      );
      const fresh = await this.artifacts.findOne({ where: { id } });
      if (fresh) {
        fresh.validationReport = report;
        fresh.validationStatus = passed
          ? warnings.length
            ? 'passed_with_warnings'
            : 'passed'
          : 'failed';
        await this.artifacts.save(fresh);
      }
      await ctx.log({
        stage: 'result',
        severity: passed ? (warnings.length ? 'warning' : 'success') : 'error',
        message: passed
          ? warnings.length
            ? `Validation passed with ${warnings.length} warning(s)`
            : 'Validation passed'
          : `Validation failed with ${findings.length} finding(s)`,
        progress: 95,
      });

      this.events.emit({
        type: 'validation.ready',
        projectId: art.projectId,
        jobId: job.id,
        correlationId,
        payload: {
          artifactId: id,
          passed,
          validationStatus: fresh?.validationStatus,
        },
      });

      return {
        resultRefs: {
          artifactId: id,
          validationStatus: fresh?.validationStatus ?? 'failed',
        },
        warnings: warnings.length && passed ? [`${warnings.length} validation warning(s)`] : [],
      };
    });

    return { jobId: job.id, status: job.status, artifactId: id };
  }

  /**
   * Governed validation exception (FR-V3-ENT-002, §23.3): an authorised role
   * can override a failed validation with a recorded reason. The artefact
   * moves to the `overridden` validation state and the decision is stored as
   * a `validation_exception` approval record.
   */
  async overrideValidation(
    id: string,
    reason: string,
    user: AuthUser,
    correlationId?: string,
  ) {
    const art = await this.getOne(id, user);
    if (!reason?.trim()) {
      throw new ConflictAppException(
        'A written reason is required to override validation.',
        'reason_required',
      );
    }
    art.validationStatus = 'overridden';
    await this.artifacts.save(art);
    await this.approvals.recordStandalone(
      'validation_exception',
      id,
      art.projectId,
      'approved',
      reason,
      user,
      correlationId,
    );
    this.events.emit({
      type: 'validation.ready',
      projectId: art.projectId,
      correlationId,
      payload: { artifactId: id, passed: true, validationStatus: 'overridden' },
    });
    return { artifactId: id, validationStatus: art.validationStatus };
  }

  async approve(
    id: string,
    decision: ApprovalDecision,
    comment: string,
    user: AuthUser,
    correlationId?: string,
  ) {
    const art = await this.getOne(id, user);
    // FR-AUT-010 precondition: an artefact must be validated before approval
    // (a governed override counts, §23.3).
    const validated = ['passed', 'passed_with_warnings', 'overridden'].includes(
      art.validationStatus,
    );
    if (decision === 'approved' && !validated) {
      throw new ConflictAppException(
        `Automation ${id} must pass validation before approval ` +
          `(current: ${art.validationStatus}).`,
        'validation_required',
        { artifactId: id, validationStatus: art.validationStatus },
      );
    }
    return this.approvals.decide(
      'automation',
      id,
      decision,
      comment,
      user,
      correlationId,
    );
  }

  async executionPlan(id: string, user: AuthUser, correlationId?: string) {
    const art = await this.getOne(id, user);
    const project = await this.projects.findOne({
      where: { id: art.projectId },
    });
    const cases = await this.cases.find({
      where: { id: In(art.testCaseIds ?? []) },
    });
    const raw = (await this.engine.executionPlan(
      {
        testCases: cases.map((c) => ({
          id: c.id,
          case_key: c.caseKey,
          title: c.title,
          steps: c.steps ?? [],
          expected_results: c.expectedResults ?? [],
        })),
        baseUrl: project?.baseUrl || '',
      },
      correlationId,
    )) as { schema_version?: string; plans?: Record<string, unknown>[] };

    // Normalise the engine's snake_case wire format to the API contract's
    // camelCase (AIQA-EXEC-004: the raw pass-through crashed the frontend,
    // which reads plan.testCaseId / step.actionType).
    const plans = (raw.plans ?? []).map((p) => ({
      testCaseId: String(p.test_case_id ?? p.testCaseId ?? ''),
      caseKey: String(p.case_key ?? p.caseKey ?? ''),
      title: String(p.title ?? ''),
      steps: ((p.steps as Record<string, unknown>[]) ?? []).map((s) => ({
        sequence: Number(s.sequence ?? 0),
        actionType: String(s.action_type ?? s.actionType ?? ''),
        target: String(s.target ?? ''),
        description: String(s.description ?? ''),
        expected: String(s.expected ?? ''),
      })),
    }));
    return { schemaVersion: raw.schema_version ?? 'v1', plans };
  }
}

/**
 * The wire form of one resolved step for the engine (§12).
 *
 * snake_case because that is the engine's convention, and deliberately
 * complete: the agent needs the locator's identity and version to emit the
 * traceability comment, and its machine-readable definition so that nothing
 * downstream has to parse the expression string back into a locator.
 */
function toEngineStep(step: ResolvedAutomationLocator): Record<string, unknown> {
  return {
    test_step_id: step.testStepId,
    test_case_id: step.testCaseId,
    sequence: step.sequence,
    action: step.action,
    description: step.description,
    value_reference: step.valueReference ?? '',
    page_name: step.pageName,
    page_url_pattern: step.pageUrlPattern,
    element_name: step.elementName,
    locator: {
      locator_id: step.locatorId,
      locator_version: step.locatorVersion,
      strategy: step.strategy,
      expression: step.expression,
      python_expression: step.pythonExpression,
      locator_data: step.locatorData,
      confidence: step.locatorConfidence,
      validation_status: step.validationStatus,
      source: step.source,
    },
  };
}

/** The note the generator emits for a step no approved locator matched. */
const UNMATCHED_NOTE = 'NO APPROVED LOCATOR MATCHED';

/** How many steps the generated file actually left for review. */
export function countUnmatchedNotes(content: string): number {
  if (!content) return 0;
  return content.split(UNMATCHED_NOTE).length - 1;
}

/**
 * The locator validation result shown with the generated file (§4).
 *
 * Derived from what the generation actually did, never hardcoded: a file whose
 * every step reused an approved locator reports `Approved`, and one with a gap
 * reports the gap. Neither outcome blocks approval or execution (§5).
 */
export type LocatorValidation = 'approved' | 'partial' | 'none';

export function locatorValidationOf(
  boundSteps: number,
  unmatchedNotes: number,
): LocatorValidation {
  if (boundSteps > 0 && unmatchedNotes === 0) return 'approved';
  if (boundSteps > 0) return 'partial';
  return 'none';
}

/**
 * Whether a generated file still mentions a specific unbound step.
 *
 * Matching is on the step's distinctive words rather than the whole sentence,
 * because the generator rewrites step text into a comment rather than quoting
 * it verbatim.
 */
export function contentMentionsStep(content: string, stepText: string): boolean {
  const words = (stepText || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  if (!words.length) return true;
  const haystack = content.toLowerCase();
  const hits = words.filter((w) => haystack.includes(w)).length;
  return hits >= Math.ceil(words.length / 2);
}

/** The compact form shown next to the code in the Automation Code tab (§10). */
function toUsageEntry(step: ResolvedAutomationLocator): Record<string, unknown> {
  return {
    locatorId: step.locatorId,
    locatorVersion: step.locatorVersion,
    testStepId: step.testStepId,
    testStep: step.description,
    elementName: step.elementName,
    pageName: step.pageName,
    pageUrlPattern: step.pageUrlPattern,
    role: step.role,
    strategy: step.strategy,
    expression: step.pythonExpression || step.expression,
    confidence: step.locatorConfidence,
    matchConfidence: step.elementMatchConfidence,
    validationStatus: step.validationStatus,
    validatedAt: step.validatedAt,
    source: step.source,
    scanId: step.scanId,
    scannedElementId: step.scannedElementId,
    awaitingApproval: step.awaitingApproval,
  };
}

/**
 * The traceability row for a library locator used without a step binding (§9).
 *
 * The step fields are empty because there genuinely is no step: the agent
 * reached for a validated locator the matcher did not bind. The file→locator
 * half of the chain is still worth recording — it is what lets a locator change
 * find its dependents.
 */
function toLibraryReference(
  locator: ResolvedLocator,
  projectId: string,
  generationRunId: string,
  artifactId: string,
): Omit<StepLocatorReference, 'id' | 'createdAt'> {
  return {
    projectId,
    testCaseId: '',
    testStepId: '',
    stepSequence: 0,
    testStepText: '',
    generatedAutomationId: generationRunId,
    generatedFileId: artifactId,
    scannedElementId: '',
    elementName: locator.elementName,
    pageName: '',
    pageUrlPattern: locator.pageUrlPattern,
    locatorId: locator.id,
    locatorVersion: locator.version,
    scanId: null,
    strategy: locator.strategy,
    // No step was matched to it, so there is no match confidence to report.
    elementMatchConfidence: 0,
    locatorConfidence: locator.confidenceScore,
    validationStatus: 'approved',
    source: locator.source === 'manual' ? 'MANUAL_EDIT' : 'DETERMINISTIC_SCANNER',
    generatedExpression: locator.pythonExpression || locator.expression,
    matchRationale: { boundToStep: false, reason: 'used from the project library' },
    validatedAt: null,
    resolvedAt: new Date(),
  };
}

/** The persisted traceability row for one generated interaction (§9). */
function toReference(
  step: ResolvedAutomationLocator,
  generationRunId: string,
  artifactId: string,
): Omit<StepLocatorReference, 'id' | 'createdAt'> {
  return {
    projectId: step.projectId,
    testCaseId: step.testCaseId,
    testStepId: step.testStepId,
    stepSequence: step.sequence,
    testStepText: step.description,
    generatedAutomationId: generationRunId,
    generatedFileId: artifactId,
    scannedElementId: step.scannedElementId,
    elementName: step.elementName,
    pageName: step.pageName,
    pageUrlPattern: step.pageUrlPattern,
    locatorId: step.locatorId,
    locatorVersion: step.locatorVersion,
    scanId: step.scanId,
    strategy: step.strategy,
    elementMatchConfidence: step.elementMatchConfidence,
    locatorConfidence: step.locatorConfidence,
    validationStatus: step.validationStatus,
    source: step.source,
    generatedExpression: step.pythonExpression || step.expression,
    matchRationale: step.matchRationale,
    validatedAt: step.validatedAt ? new Date(step.validatedAt) : null,
    resolvedAt: new Date(),
  };
}
