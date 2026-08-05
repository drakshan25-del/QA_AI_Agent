import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ObjectLiteral, Repository } from 'typeorm';
import {
  LocatorRecord,
  Project,
  ScannedElement,
  UiScan,
} from '../../entities';
import { AuthUser } from '../../common/decorators';
import { ConflictAppException, ValidationFailedException } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MembershipService } from '../../common/access/membership.service';
import { EngineClient } from '../../engine/engine.client';
import { LocatorStorageService } from './locator-storage.service';
import { UiScanArtifactsService } from './ui-scan-artifacts.service';
import { UiScanLoggerService } from './ui-scan-logger.service';
import { UiScannerService } from './ui-scanner.service';
import { MAX_PROJECT_CONCURRENT_SCANS } from './ui-scanner.limits';

const USER: AuthUser = {
  id: 'user-1',
  email: 'qa@example.com',
  role: 'qa_engineer',
};

const PROJECT: Partial<Project> = {
  id: 'project-1',
  baseUrl: 'https://example.com',
  allowedDomains: 'localhost,127.0.0.1',
  llmModel: 'qwen2.5:latest',
  llmTemperature: 0.1,
};

/**
 * Scan admission (FR-UIS-002, §16, §23).
 *
 * These cover what happens *before* a browser is ever launched: the SSRF gate,
 * the concurrency and rate limits, and — most importantly — the guarantee that
 * the credentials a user types are forwarded once and never written to the
 * scan record.
 */
describe('UiScannerService.start', () => {
  let service: UiScannerService;
  let scans: jest.Mocked<Repository<UiScan>>;
  let engine: { startUiScan: jest.Mock; streamRunEvents: jest.Mock; getUiScanResult: jest.Mock };
  let saved: Partial<UiScan>[];

  beforeEach(async () => {
    saved = [];
    const repo = <T extends ObjectLiteral>(
      overrides: Partial<Repository<T>> = {},
    ) =>
      ({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        save: jest.fn().mockImplementation((row) => Promise.resolve(row)),
        create: jest.fn().mockImplementation((row) => row),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        delete: jest.fn().mockResolvedValue({ affected: 0 }),
        ...overrides,
      }) as unknown as jest.Mocked<Repository<T>>;

    scans = repo<UiScan>({
      create: jest.fn().mockImplementation((row) => ({ id: 'scan-1', ...row })),
      save: jest.fn().mockImplementation((row: Partial<UiScan>) => {
        saved.push(row);
        return Promise.resolve({ id: 'scan-1', ...row });
      }),
    });

    engine = {
      // Never resolves: the scan stays "running" so concurrency is observable.
      startUiScan: jest.fn().mockResolvedValue({ scanId: 'scan-1', status: 'running' }),
      streamRunEvents: jest.fn().mockImplementation(() => new Promise(() => {})),
      getUiScanResult: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UiScannerService,
        { provide: getRepositoryToken(UiScan), useValue: scans },
        { provide: getRepositoryToken(ScannedElement), useValue: repo<ScannedElement>() },
        { provide: getRepositoryToken(LocatorRecord), useValue: repo<LocatorRecord>() },
        {
          provide: getRepositoryToken(Project),
          useValue: repo<Project>({
            findOne: jest.fn().mockResolvedValue(PROJECT as Project),
          }),
        },
        { provide: MembershipService, useValue: { ensureMember: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: EventsService, useValue: { emit: jest.fn() } },
        { provide: NotificationsService, useValue: { notify: jest.fn() } },
        { provide: EngineClient, useValue: engine },
        {
          provide: UiScanLoggerService,
          useValue: {
            forScan: () => ({
              stage: jest.fn(),
              setStage: jest.fn(),
              debug: jest.fn(),
              info: jest.fn(),
              warning: jest.fn(),
              error: jest.fn(),
              success: jest.fn(),
              currentStage: 'QUEUED',
            }),
            write: jest.fn(),
            fetch: jest.fn().mockResolvedValue([]),
            release: jest.fn(),
          },
        },
        {
          provide: UiScanArtifactsService,
          useValue: {
            readStorageState: jest.fn(),
            listStorageStates: jest.fn().mockResolvedValue([]),
            saveScreenshot: jest.fn().mockResolvedValue(''),
            saveAccessibilitySnapshot: jest.fn().mockResolvedValue(''),
          },
        },
        {
          provide: LocatorStorageService,
          useValue: { countApproved: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();

    service = moduleRef.get(UiScannerService);
  });

  it('accepts a public URL and hands the scan to the engine', async () => {
    const result = await service.start(
      'project-1',
      { url: 'https://example.com/dashboard' },
      USER,
      'corr-1',
    );

    expect(result.status).toBe('QUEUED');
    expect(engine.startUiScan).toHaveBeenCalledTimes(1);
    const request = engine.startUiScan.mock.calls[0][0];
    expect(request.url).toBe('https://example.com/dashboard');
    expect(request.allowedHosts).toEqual(['localhost', '127.0.0.1']);
  });

  it('uses the project model rather than a hard-coded default', async () => {
    await service.start('project-1', { url: 'https://example.com/' }, USER);
    expect(engine.startUiScan.mock.calls[0][0].model).toBe('qwen2.5:latest');
  });

  it('forwards credentials to the engine but never persists them', async () => {
    await service.start(
      'project-1',
      {
        url: 'https://example.com/dashboard',
        username: 'qa@example.com',
        password: 'sup3r-s3cret',
        loginUrl: 'https://example.com/login',
      },
      USER,
    );

    const request = engine.startUiScan.mock.calls[0][0];
    expect(request.username).toBe('qa@example.com');
    expect(request.password).toBe('sup3r-s3cret');

    // Nothing credential-shaped may reach the persisted row.
    const serialised = JSON.stringify(saved);
    expect(serialised).not.toContain('sup3r-s3cret');
    expect(serialised).not.toContain('qa@example.com');
    expect(saved[0].authenticated).toBe(true);
    expect(saved[0].options).not.toHaveProperty('password');
    expect(saved[0].options).not.toHaveProperty('username');
  });

  it('refuses an internal address that is not on the project allow-list', async () => {
    await expect(
      service.start('project-1', { url: 'http://10.0.0.9/admin' }, USER),
    ).rejects.toBeInstanceOf(ValidationFailedException);
    expect(engine.startUiScan).not.toHaveBeenCalled();
  });

  it('refuses a non-http scheme', async () => {
    await expect(
      service.start('project-1', { url: 'file:///etc/passwd' }, USER),
    ).rejects.toBeInstanceOf(ValidationFailedException);
  });

  it('validates the login URL as strictly as the target', async () => {
    await expect(
      service.start(
        'project-1',
        {
          url: 'https://example.com/dashboard',
          loginUrl: 'http://169.254.169.254/',
        },
        USER,
      ),
    ).rejects.toThrow(/metadata/i);
  });

  it('clamps out-of-range settings instead of trusting the client', async () => {
    await service.start(
      'project-1',
      {
        url: 'https://example.com/',
        timeoutMs: 1,
        maxElements: 999_999,
        maxPages: 999,
      },
      USER,
    );
    const request = engine.startUiScan.mock.calls[0][0];
    expect(request.timeoutMs).toBeGreaterThanOrEqual(5_000);
    expect(request.maxElements).toBeLessThanOrEqual(1_000);
    // A crawl without a ceiling is a crawler loose in a production app.
    expect(request.maxPages).toBeLessThanOrEqual(25);
  });

  it('scans a single page unless crawling is asked for', async () => {
    await service.start('project-1', { url: 'https://example.com/' }, USER);
    expect(engine.startUiScan.mock.calls[0][0].maxPages).toBe(1);
  });

  it('holds a project to its concurrency limit', async () => {
    for (let i = 0; i < MAX_PROJECT_CONCURRENT_SCANS; i++) {
      await service.start('project-1', { url: 'https://example.com/' }, USER);
    }
    await expect(
      service.start('project-1', { url: 'https://example.com/' }, USER),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('reports a scan that does not belong to the project as not found', async () => {
    scans.findOne = jest
      .fn()
      .mockResolvedValue({ id: 'scan-9', projectId: 'other-project' } as UiScan);
    await expect(service.getOne('project-1', 'scan-9', USER)).rejects.toThrow(
      /not found in this project/,
    );
  });
});
