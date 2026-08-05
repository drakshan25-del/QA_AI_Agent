import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LocatorRecord } from '../../entities';
import { AuditService } from '../audit/audit.service';
import { LocatorStorageService } from './locator-storage.service';

/**
 * The locator lifecycle after this change (FR-UIS-025 §2).
 *
 *   scan → user approves → approval is final → generate → execute
 *
 * There is no review stage. Once a user approves a locator it is immediately
 * available to automation generation, and nothing sends it back.
 */
describe('locator approval lifecycle', () => {
  let service: LocatorStorageService;
  let rows: LocatorRecord[];

  const scan = {
    id: 'scan-1',
    projectId: 'project-1',
    url: 'https://app.test/login',
    finalUrl: 'https://app.test/login',
    pageTitle: 'Login',
  };
  const asScan = (value: typeof scan) => value as unknown as Parameters<
    LocatorStorageService['saveApproved']
  >[0];

  const user = { id: 'user-1', email: 'qa@example.com', role: 'qa_engineer' } as never;

  const element = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'el-1',
      scanId: 'scan-1',
      projectId: 'project-1',
      elementKey: 'f0:input:textbox:username',
      tagName: 'input',
      role: 'textbox',
      accessibleName: 'Username',
      visibleText: '',
      attributes: {},
      states: {},
      position: {},
      context: {},
      frame: null,
      status: 'unique',
      pageUrl: 'https://app.test/login',
      recommendedLocatorId: 'c1',
      candidates: [
        {
          id: 'c1',
          strategy: 'role',
          expression: "page.getByRole('textbox', { name: 'Username', exact: true })",
          pythonExpression: 'page.get_by_role("textbox", name="Username", exact=True)',
          locatorData: { strategy: 'role', role: 'textbox', name: 'Username' },
          confidence: 0.98,
          matchCount: 1,
          unique: true,
          valid: true,
          reasons: [],
          warnings: [],
          source: 'deterministic-scanner',
        },
      ],
      ...overrides,
    }) as never;

  beforeEach(async () => {
    rows = [];
    const repo = {
      findOne: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(
          rows.find(
            (r) =>
              r.projectId === where.projectId &&
              r.elementKey === where.elementKey &&
              r.active === where.active,
          ) ?? null,
        ),
      ),
      find: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(
          rows.filter(
            (r) =>
              (where.projectId === undefined || r.projectId === where.projectId) &&
              (where.approved === undefined || r.approved === where.approved) &&
              (where.active === undefined || r.active === where.active),
          ),
        ),
      ),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((row) => ({ id: `loc-${rows.length + 1}`, ...row })),
      save: jest.fn().mockImplementation((row) => {
        const existing = rows.findIndex((r) => r.id === row.id);
        if (existing >= 0) rows[existing] = row;
        else rows.push(row);
        return Promise.resolve(row);
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LocatorStorageService,
        { provide: getRepositoryToken(LocatorRecord), useValue: repo },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(LocatorStorageService);
  });

  it('approving a locator stores it as approved', async () => {
    const { saved, records } = await service.saveApproved(
      asScan(scan),
      [element()],
      user,
      'Login',
    );
    expect(saved).toBe(1);
    expect(records[0].approved).toBe(true);
    expect(records[0].active).toBe(true);
    expect(records[0].approvedBy).toBe('user-1');
  });

  it('an approved locator is immediately available to generation', async () => {
    await service.saveApproved(asScan(scan), [element()], user, 'Login');
    const library = await service.approvedForProject('project-1');
    expect(library).toHaveLength(1);
    expect(library[0].pythonExpression).toBe(
      'page.get_by_role("textbox", name="Username", exact=True)',
    );
  });

  it('stores the selector exactly as scanned, for verbatim reuse', async () => {
    const { records } = await service.saveApproved(asScan(scan), [element()], user, 'Login');
    const library = await service.approvedForProject('project-1');
    expect(library[0].pythonExpression).toBe(records[0].pythonExpression);
    expect(library[0].expression).toBe(records[0].expression);
  });

  it('approval survives rescanning the same element', async () => {
    // Requirement: a rescan that finds the same element with the same selector
    // must not cost the user their approval.
    await service.saveApproved(asScan(scan), [element()], user, 'Login');
    const before = rows[0];
    await service.saveApproved(asScan({ ...scan, id: 'scan-2' }), [element()], user, 'Login');

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(before.id);
    expect(rows[0].approved).toBe(true);
    expect(rows[0].version).toBe(before.version);
  });

  it('a changed selector supersedes the old row rather than dropping approval', async () => {
    await service.saveApproved(asScan(scan), [element()], user, 'Login');
    const changed = element({
      candidates: [
        {
          ...(element() as never as { candidates: Record<string, unknown>[] }).candidates[0],
          expression: "page.getByLabel('Username', { exact: true })",
          pythonExpression: 'page.get_by_label("Username", exact=True)',
        },
      ],
    });
    const { superseded } = await service.saveApproved(asScan(scan), [changed], user, 'Login');

    expect(superseded).toBe(1);
    const active = rows.filter((r) => r.active);
    expect(active).toHaveLength(1);
    expect(active[0].approved).toBe(true);
    expect(active[0].version).toBe(2);
    // The superseded row stays for history, deactivated.
    expect(rows.filter((r) => !r.active)).toHaveLength(1);
  });

  it('never returns a locator belonging to another project', async () => {
    await service.saveApproved(asScan(scan), [element()], user, 'Login');
    rows.push({
      ...rows[0],
      id: 'other-project-locator',
      projectId: 'project-2',
    } as LocatorRecord);

    const library = await service.approvedForProject('project-1');
    expect(library).toHaveLength(1);
    expect(library.every((l) => l.id !== 'other-project-locator')).toBe(true);
  });

  it('an unapproved locator is not offered to generation', async () => {
    await service.saveApproved(asScan(scan), [element()], user, 'Login');
    rows[0].approved = false;
    expect(await service.approvedForProject('project-1')).toHaveLength(0);
  });

  it('a deactivated locator is not offered to generation', async () => {
    await service.saveApproved(asScan(scan), [element()], user, 'Login');
    rows[0].active = false;
    expect(await service.approvedForProject('project-1')).toHaveLength(0);
  });

  it('no stored locator ever carries a review status', async () => {
    await service.saveApproved(asScan(scan), [element()], user, 'Login');
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toMatch(/review[_ ]?required/i);
    }
  });
});
