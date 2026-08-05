import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LocatorRecord, StepLocatorReference } from '../../entities';
import { LocatorStorageService } from './locator-storage.service';
import { LocatorUsageService, isLocatorFailure } from './locator-usage.service';

/**
 * Locator traceability and usage metrics (FR-UIS-025 §9, §15).
 *
 * The interesting behaviour here is blame attribution: a failing test says
 * almost nothing about the locator unless the failure *is* the locator, and
 * recording it otherwise would slowly poison a perfectly good library.
 */

function reference(
  overrides: Partial<StepLocatorReference> = {},
): Omit<StepLocatorReference, 'id' | 'createdAt'> {
  return {
    projectId: 'project-1',
    testCaseId: 'tc-1',
    testStepId: 'tc-1:step-1',
    stepSequence: 1,
    testStepText: 'Click Login',
    generatedAutomationId: 'run-1',
    generatedFileId: 'artifact-1',
    scannedElementId: 'element-1',
    elementName: 'Login',
    pageName: 'Login',
    pageUrlPattern: 'https://app.example.com/login',
    locatorId: 'locator-login',
    locatorVersion: 3,
    scanId: 'scan-1',
    strategy: 'role',
    elementMatchConfidence: 0.97,
    locatorConfidence: 0.98,
    validationStatus: 'approved',
    source: 'DETERMINISTIC_SCANNER',
    generatedExpression: 'page.get_by_role("button", name="Login", exact=True)',
    matchRationale: null,
    validatedAt: new Date(),
    resolvedAt: new Date(),
    ...overrides,
  } as Omit<StepLocatorReference, 'id' | 'createdAt'>;
}

describe('LocatorUsageService', () => {
  let service: LocatorUsageService;
  let references: {
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
  };
  let locators: { increment: jest.Mock; update: jest.Mock };
  let storage: { invalidate: jest.Mock; findById: jest.Mock };

  beforeEach(async () => {
    references = {
      create: jest.fn().mockImplementation((row) => row),
      save: jest.fn().mockImplementation((rows) => Promise.resolve(rows)),
      find: jest.fn().mockResolvedValue([]),
    };
    locators = {
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    storage = { invalidate: jest.fn(), findById: jest.fn().mockResolvedValue(null) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LocatorUsageService,
        { provide: getRepositoryToken(StepLocatorReference), useValue: references },
        { provide: getRepositoryToken(LocatorRecord), useValue: locators },
        { provide: LocatorStorageService, useValue: storage },
      ],
    }).compile();
    service = moduleRef.get(LocatorUsageService);
  });

  it('writes the step→locator references in one bulk insert', async () => {
    await service.recordGeneration('project-1', [
      reference(),
      reference({ testStepId: 'tc-1:step-2', stepSequence: 2 }),
    ]);
    expect(references.save).toHaveBeenCalledTimes(1);
    expect(references.save.mock.calls[0][0]).toHaveLength(2);
  });

  it('bumps usage once per locator, not once per step', async () => {
    await service.recordGeneration('project-1', [
      reference(),
      reference({ testStepId: 'tc-1:step-2', stepSequence: 2 }),
      reference({ locatorId: 'locator-email', testStepId: 'tc-1:step-3', stepSequence: 3 }),
    ]);
    expect(locators.increment).toHaveBeenCalledTimes(2);
    expect(locators.increment).toHaveBeenCalledWith(
      { id: 'locator-login' },
      'usageCount',
      2,
    );
    expect(locators.increment).toHaveBeenCalledWith(
      { id: 'locator-email' },
      'usageCount',
      1,
    );
  });

  it('records the generation, test case and step a locator was last used by', async () => {
    await service.recordGeneration('project-1', [reference()]);
    expect(locators.update).toHaveBeenCalledWith(
      { id: 'locator-login' },
      expect.objectContaining({
        lastUsedAutomationId: 'run-1',
        lastUsedTestCaseId: 'tc-1',
        lastUsedTestStepId: 'tc-1:step-1',
      }),
    );
  });

  it('counts a passing test as a success for every locator it used', async () => {
    references.find.mockResolvedValue([reference()]);
    const { updated, locatorFailures } = await service.recordExecutionOutcome(
      'project-1',
      [{ artifactIds: ['artifact-1'], outcome: 'passed' }],
    );
    expect(updated).toBe(1);
    expect(locatorFailures).toBe(0);
    expect(locators.increment).toHaveBeenCalledWith(
      { id: 'locator-login' },
      'executionSuccessCount',
      1,
    );
  });

  it('records a locator failure when the locator itself did not resolve', async () => {
    references.find.mockResolvedValue([reference()]);
    const { locatorFailures } = await service.recordExecutionOutcome('project-1', [
      {
        artifactIds: ['artifact-1'],
        outcome: 'failed',
        errorMessage:
          'locator.click: Timeout 30000ms exceeded. waiting for locator("#login")',
      },
    ]);
    expect(locatorFailures).toBe(1);
    expect(locators.increment).toHaveBeenCalledWith(
      { id: 'locator-login' },
      'executionFailureCount',
      1,
    );
    expect(locators.update).toHaveBeenCalledWith(
      { id: 'locator-login' },
      expect.objectContaining({ locatorFailure: true }),
    );
  });

  it('does not blame the locator for an assertion failure', async () => {
    references.find.mockResolvedValue([reference()]);
    const { locatorFailures, updated } = await service.recordExecutionOutcome(
      'project-1',
      [
        {
          artifactIds: ['artifact-1'],
          outcome: 'failed',
          errorMessage: 'Expect "to contain text" failed. Expected string: "Welcome"',
        },
      ],
    );
    expect(locatorFailures).toBe(0);
    expect(updated).toBe(0);
    expect(locators.increment).not.toHaveBeenCalled();
  });

  it('does nothing when the run produced no locator-backed results', async () => {
    references.find.mockResolvedValue([]);
    const result = await service.recordExecutionOutcome('project-1', [
      { artifactIds: ['artifact-9'], outcome: 'failed', errorMessage: 'boom' },
    ]);
    expect(result).toEqual({ updated: 0, locatorFailures: 0 });
  });
});

describe('isLocatorFailure', () => {
  const locatorFailures = [
    'strict mode violation: locator resolved to 3 elements',
    'Error: locator.fill: Timeout 30000ms exceeded',
    'waiting for locator("#save")',
    'Element is not attached to the DOM',
    'locator resolved to no elements',
  ];
  it.each(locatorFailures)('treats %s as a locator failure', (message) => {
    expect(isLocatorFailure(message)).toBe(true);
  });

  const notLocatorFailures = [
    'Expect "to have text" failed. Expected: Welcome, Received: Goodbye',
    'AssertionError: expected 200 but got 500',
    'requests.exceptions.ConnectionError: backend unreachable',
    'KeyError: test data "promo" is missing',
    '',
  ];
  it.each(notLocatorFailures)('does not blame the locator for %s', (message) => {
    expect(isLocatorFailure(message)).toBe(false);
  });
});
