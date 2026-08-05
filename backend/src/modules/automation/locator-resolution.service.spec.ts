import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LocatorRecord, Project, TestCase } from '../../entities';
import { AuthUser } from '../../common/decorators';
import { EngineClient } from '../../engine/engine.client';
import { LocatorStorageService } from '../ui-scanner/locator-storage.service';
import { UiScanArtifactsService } from '../ui-scanner/ui-scan-artifacts.service';
import { UiScannerService } from '../ui-scanner/ui-scanner.service';
import { ElementMatcherService } from './element-matcher.service';
import { LocatorResolutionService } from './locator-resolution.service';
import { LOCATOR_FRESHNESS_MS } from './locator-resolution.limits';

/**
 * The locator source-priority ladder (FR-UIS-025 §2, §4, §5, §11).
 *
 * What these pin down is the promise the whole integration rests on: a valid
 * scanned locator is never skipped, a rejected or superseded one is never
 * used, an uncertain one goes back to the browser before it is trusted, and a
 * step nothing covers is marked for review rather than given an invented
 * selector.
 */

const USER: AuthUser = { id: 'user-1', email: 'qa@example.com', role: 'qa_engineer' };

const PROJECT: Partial<Project> = {
  id: 'project-1',
  baseUrl: 'https://app.example.com',
  allowedDomains: 'app.example.com',
  llmModel: 'qwen2.5:latest',
  llmTemperature: 0.1,
};

function locator(overrides: Partial<LocatorRecord> = {}): LocatorRecord {
  return {
    id: 'locator-login',
    projectId: 'project-1',
    scanId: 'scan-1',
    scannedElementId: 'element-login',
    elementKey: 'login-button',
    pageName: 'Login',
    pageUrlPattern: 'https://app.example.com/login',
    elementName: 'Login',
    role: 'button',
    frameKey: '',
    pageState: '',
    strategy: 'role',
    locatorData: { strategy: 'role', role: 'button', name: 'Login', exact: true },
    expression: "page.getByRole('button', { name: 'Login', exact: true })",
    pythonExpression: 'page.get_by_role("button", name="Login", exact=True)',
    confidenceScore: 0.98,
    matchCount: 1,
    validationStatus: 'approved',
    approved: true,
    active: true,
    version: 3,
    supersedesId: null,
    source: 'deterministic-scanner',
    rationale: null,
    elementSnapshot: {
      tagName: 'button',
      role: 'button',
      accessibleName: 'Login',
      visibleText: 'Login',
      attributes: {},
      context: {},
    },
    createdBy: 'user-1',
    approvedBy: 'user-1',
    lastValidatedAt: new Date(),
    usageCount: 0,
    lastUsedAt: null,
    lastUsedAutomationId: null,
    lastUsedTestCaseId: null,
    lastUsedTestStepId: null,
    executionSuccessCount: 0,
    executionFailureCount: 0,
    lastExecutedAt: null,
    lastFailureReason: '',
    locatorFailure: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LocatorRecord;
}

const LOGIN_CASE = {
  id: 'tc-1',
  caseKey: 'TC-001',
  steps: ['Click Login'],
} as unknown as TestCase;

describe('LocatorResolutionService', () => {
  let service: LocatorResolutionService;
  let storage: {
    activeForProject: jest.Mock;
    findById: jest.Mock;
    findManyByIds: jest.Mock;
    recordValidation: jest.Mock;
    invalidate: jest.Mock;
  };
  let engine: { validateUiLocators: jest.Mock; matchLocators: jest.Mock };
  let scanner: { start: jest.Mock; getOne: jest.Mock; cancel: jest.Mock };

  const build = async (rows: LocatorRecord[]) => {
    storage = {
      activeForProject: jest.fn().mockResolvedValue(rows),
      findById: jest.fn().mockResolvedValue(rows[0] ?? null),
      findManyByIds: jest.fn().mockResolvedValue(rows),
      recordValidation: jest.fn().mockImplementation((row) => Promise.resolve(row)),
      invalidate: jest.fn(),
    };
    engine = {
      validateUiLocators: jest.fn().mockResolvedValue({ results: [] }),
      matchLocators: jest.fn().mockResolvedValue({ matches: [] }),
    };
    scanner = {
      start: jest.fn(),
      getOne: jest.fn(),
      cancel: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LocatorResolutionService,
        ElementMatcherService,
        {
          provide: getRepositoryToken(Project),
          useValue: { findOne: jest.fn().mockResolvedValue(PROJECT as Project) },
        },
        {
          provide: getRepositoryToken(TestCase),
          useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
        },
        { provide: LocatorStorageService, useValue: storage },
        { provide: EngineClient, useValue: engine },
        { provide: UiScannerService, useValue: scanner },
        { provide: UiScanArtifactsService, useValue: { readStorageState: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(LocatorResolutionService);
  };

  it('binds a step to an approved, freshly validated locator without touching a browser', async () => {
    await build([locator()]);

    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);

    expect(result.status).toBe('RESOLVED');
    expect(result.resolvedSteps).toHaveLength(1);
    const step = result.resolvedSteps[0]!;
    expect(step.locatorId).toBe('locator-login');
    expect(step.locatorVersion).toBe(3);
    expect(step.source).toBe('DETERMINISTIC_SCANNER');
    expect(step.pythonExpression).toBe(
      'page.get_by_role("button", name="Login", exact=True)',
    );
    expect(step.revalidated).toBe(false);
    // Priority 1 exists precisely so generation does not open a browser.
    expect(engine.validateUiLocators).not.toHaveBeenCalled();
  });

  it('carries the locator id, version and validation status into the contract', async () => {
    await build([locator()]);
    const step = (await service.resolveTestCase('project-1', LOGIN_CASE, USER))
      .resolvedSteps[0]!;
    expect(step).toMatchObject({
      projectId: 'project-1',
      applicationId: 'https://app.example.com',
      testCaseId: 'tc-1',
      testStepId: 'tc-1:step-1',
      locatorId: 'locator-login',
      locatorVersion: 3,
      strategy: 'role',
      validationStatus: 'approved',
      scannedElementId: 'element-login',
    });
    expect(step.validatedAt).toBeTruthy();
  });

  it('re-validates a stale locator and uses it when the page still agrees', async () => {
    const stale = locator({
      lastValidatedAt: new Date(Date.now() - LOCATOR_FRESHNESS_MS - 60_000),
    });
    await build([stale]);
    engine.validateUiLocators.mockResolvedValue({
      results: [{ id: 'locator-login', matchCount: 1, unique: true, valid: true }],
    });

    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);

    expect(engine.validateUiLocators).toHaveBeenCalledTimes(1);
    expect(result.resolvedSteps[0]!.revalidated).toBe(true);
    expect(result.revalidatedLocatorIds).toEqual(['locator-login']);
    expect(storage.recordValidation).toHaveBeenCalled();
  });

  it('reports no approved match when re-validation no longer finds the element', async () => {
    await build([locator({ lastValidatedAt: null })]);
    engine.validateUiLocators.mockResolvedValue({
      results: [
        {
          id: 'locator-login',
          matchCount: 0,
          unique: false,
          valid: false,
          error: 'matched no elements on the page',
        },
      ],
    });

    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);

    expect(result.status).toBe('NO_APPROVED_MATCH');
    expect(result.resolvedSteps).toHaveLength(0);
    expect(result.unresolvedSteps[0]).toMatchObject({
      status: 'NO_APPROVED_MATCH',
      testStepId: 'tc-1:step-1',
      testStep: 'Click Login',
    });
    expect(result.unresolvedSteps[0]!.reason).toMatch(/no longer resolves/i);
  });

  it('re-validates a locator whose last execution failed on the locator itself', async () => {
    await build([locator({ locatorFailure: true })]);
    engine.validateUiLocators.mockResolvedValue({
      results: [{ id: 'locator-login', matchCount: 1, unique: true, valid: true }],
    });
    await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(engine.validateUiLocators).toHaveBeenCalledTimes(1);
  });

  it('re-validates a hand-edited locator before trusting it', async () => {
    await build([locator({ source: 'manual', validationStatus: 'manually_edited' })]);
    engine.validateUiLocators.mockResolvedValue({
      results: [{ id: 'locator-login', matchCount: 1, unique: true, valid: true }],
    });
    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(engine.validateUiLocators).toHaveBeenCalledTimes(1);
    expect(result.resolvedSteps[0]!.source).toBe('MANUAL_EDIT');
  });

  it('never uses a rejected locator', async () => {
    await build([locator({ validationStatus: 'rejected', approved: false })]);
    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(result.resolvedSteps).toHaveLength(0);
    expect(result.unresolvedSteps[0]!.reason).toMatch(/rejected/i);
  });

  it('never uses an inactive locator', async () => {
    // Inactive rows are excluded by the library read itself, which is the
    // point: a superseded locator cannot reach generation at all.
    await build([]);
    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(result.status).toBe('NO_APPROVED_MATCH');
    expect(result.warnings.join(' ')).toMatch(/no scanned locators/i);
  });

  it('never uses a locator with no machine-readable definition', async () => {
    await build([locator({ locatorData: {} })]);
    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(result.unresolvedSteps[0]!.reason).toMatch(/machine-readable/i);
  });

  it('holds an unapproved locator to a higher bar than an approved one', async () => {
    await build([
      locator({
        approved: false,
        validationStatus: 'unique',
        confidenceScore: 0.7,
      }),
    ]);
    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(result.resolvedSteps).toHaveLength(0);
    expect(result.unresolvedSteps[0]!.reason).toMatch(/not been approved/i);
  });

  it('uses an unapproved locator that is unique and highly confident, flagged as awaiting approval', async () => {
    await build([
      locator({
        approved: false,
        validationStatus: 'unique',
        confidenceScore: 0.97,
      }),
    ]);
    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(result.resolvedSteps[0]!.awaitingApproval).toBe(true);
  });

  it('prefers the approved locator when an unapproved one exists for the same element', async () => {
    await build([
      locator({
        id: 'locator-unapproved',
        approved: false,
        validationStatus: 'unique',
        confidenceScore: 0.99,
      }),
      locator({ id: 'locator-approved', approved: true, confidenceScore: 0.9 }),
    ]);
    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(result.resolvedSteps[0]!.locatorId).toBe('locator-approved');
  });

  it('excludes a locator belonging to a different page', async () => {
    await build([
      locator({
        id: 'locator-other-page',
        pageName: 'Billing',
        pageUrlPattern: 'https://app.example.com/billing',
      }),
    ]);
    const result = await service.resolveTestCase(
      'project-1',
      { id: 'tc-2', caseKey: 'TC-002', steps: ['Open the Login page', 'Click Login'] } as unknown as TestCase,
      USER,
    );
    expect(result.resolvedSteps).toHaveLength(0);
    expect(result.unresolvedSteps).toHaveLength(1);
  });

  it('resolves several test cases in one library read (§17 batching)', async () => {
    await build([locator()]);
    const results = await service.resolveBatch(
      'project-1',
      [
        LOGIN_CASE,
        { id: 'tc-2', caseKey: 'TC-002', steps: ['Click Login'] } as unknown as TestCase,
      ],
      USER,
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'RESOLVED')).toBe(true);
    expect(storage.activeForProject).toHaveBeenCalledTimes(1);
  });

  it('groups revalidation into one browser session per page', async () => {
    const stale = { lastValidatedAt: new Date(Date.now() - LOCATOR_FRESHNESS_MS - 1) };
    await build([
      locator({ id: 'locator-email', elementKey: 'email', elementName: 'Email address', role: 'textbox', ...stale }),
      locator({ id: 'locator-login', ...stale }),
    ]);
    engine.validateUiLocators.mockResolvedValue({
      results: [
        { id: 'locator-email', matchCount: 1, unique: true, valid: true },
        { id: 'locator-login', matchCount: 1, unique: true, valid: true },
      ],
    });

    await service.resolveTestCase(
      'project-1',
      { id: 'tc-3', caseKey: 'TC-003', steps: ['Enter the email address', 'Click Login'] } as unknown as TestCase,
      USER,
    );

    // Two steps, two stale locators, one page — and therefore one browser.
    expect(engine.validateUiLocators).toHaveBeenCalledTimes(1);
    expect(engine.validateUiLocators.mock.calls[0][0].locators).toHaveLength(2);
  });

  it('marks steps unresolved rather than failing when the page cannot be opened', async () => {
    await build([locator({ lastValidatedAt: null })]);
    engine.validateUiLocators.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));
    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(result.unresolvedSteps[0]!.reason).toMatch(/could not be opened/i);
  });

  it('only accepts a model match that names a locator it was offered', async () => {
    // Nothing in the library resembles "Confirm Membership", so the
    // deterministic pass leaves the step open for the model — which then names
    // a locator that does not exist.
    await build([locator()]);
    engine.matchLocators.mockResolvedValue({
      matches: [
        { testStepId: 'tc-4:step-1', locatorId: 'locator-that-does-not-exist' },
      ],
    });

    const result = await service.resolveTestCase(
      'project-1',
      { id: 'tc-4', caseKey: 'TC-004', steps: ['Click Confirm Membership'] } as unknown as TestCase,
      USER,
      { allowLlmMatching: true },
    );

    expect(result.resolvedSteps).toHaveLength(0);
    expect(result.unresolvedSteps).toHaveLength(1);
  });

  it('binds a model-matched step to the scanner’s own locator, marked as model-assisted', async () => {
    // The element is named differently from the step, so only a reading of the
    // language connects them — exactly the judgement the model is allowed.
    await build([
      locator({
        id: 'locator-confirm',
        elementKey: 'join',
        elementName: 'Join now',
        pageName: '',
      }),
    ]);
    engine.matchLocators.mockResolvedValue({
      matches: [{ testStepId: 'tc-5:step-1', locatorId: 'locator-confirm' }],
    });

    const result = await service.resolveTestCase(
      'project-1',
      { id: 'tc-5', caseKey: 'TC-005', steps: ['Click Confirm Membership'] } as unknown as TestCase,
      USER,
      { allowLlmMatching: true },
    );

    expect(result.resolvedSteps[0]).toMatchObject({
      locatorId: 'locator-confirm',
      source: 'LLM_FALLBACK',
      // The locator itself is still the scanner's, validated on the page.
      pythonExpression: 'page.get_by_role("button", name="Login", exact=True)',
    });
  });

  it('keeps generating when model matching fails', async () => {
    await build([locator()]);
    engine.matchLocators.mockRejectedValue(new Error('ollama unavailable'));
    const result = await service.resolveTestCase(
      'project-1',
      {
        id: 'tc-6',
        caseKey: 'TC-006',
        steps: ['Click Login', 'Click Confirm Membership'],
      } as unknown as TestCase,
      USER,
      { allowLlmMatching: true },
    );
    expect(result.status).toBe('PARTIALLY_RESOLVED');
    expect(result.resolvedSteps).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/model-assisted/i);
  });

  it('reports where the time went (§17 metrics)', async () => {
    await build([locator()]);
    const result = await service.resolveTestCase('project-1', LOGIN_CASE, USER);
    expect(result.timings).toEqual(
      expect.objectContaining({
        lookupMs: expect.any(Number),
        matchingMs: expect.any(Number),
        revalidationMs: expect.any(Number),
        llmFallbackMs: expect.any(Number),
        totalMs: expect.any(Number),
      }),
    );
  });
});
