import { User } from './user.entity';
import { Project } from './project.entity';
import { ProjectMember } from './project-member.entity';
import { SourceDocument } from './source-document.entity';
import { DocumentSegment } from './document-segment.entity';
import { Requirement } from './requirement.entity';
import { Analysis } from './analysis.entity';
import { TestPlan } from './test-plan.entity';
import { TestPlanRevision } from './test-plan-revision.entity';
import { TestCase } from './test-case.entity';
import { GeneratedArtifact } from './generated-artifact.entity';
import { GenerationRun } from './generation-run.entity';
import { ExecutionRun } from './execution-run.entity';
import { TestResult } from './test-result.entity';
import { Finding } from './finding.entity';
import { Approval } from './approval.entity';
import { AuditEvent } from './audit-event.entity';
import { ExecutionEvent } from './execution-event.entity';
import { ExecutionLogEntry } from './execution-log-entry.entity';
import { Job } from './job.entity';
import { JobLogEntry } from './job-log-entry.entity';
import { Notification } from './notification.entity';
import { ProjectSequence } from './project-sequence.entity';
import { EventSubscription } from './event-subscription.entity';
import { UiScan } from './ui-scan.entity';
import { ScannedElement } from './scanned-element.entity';
import { LocatorRecord } from './locator-record.entity';
import { UiScanLogEntry } from './ui-scan-log-entry.entity';
import { StepLocatorReference } from './step-locator-reference.entity';

export const ALL_ENTITIES = [
  User,
  Project,
  ProjectMember,
  SourceDocument,
  DocumentSegment,
  Requirement,
  Analysis,
  TestPlan,
  TestPlanRevision,
  TestCase,
  GeneratedArtifact,
  GenerationRun,
  ExecutionRun,
  TestResult,
  Finding,
  Approval,
  AuditEvent,
  ExecutionEvent,
  ExecutionLogEntry,
  Job,
  JobLogEntry,
  Notification,
  ProjectSequence,
  EventSubscription,
  UiScan,
  ScannedElement,
  LocatorRecord,
  UiScanLogEntry,
  StepLocatorReference,
];

export {
  User,
  Project,
  ProjectMember,
  SourceDocument,
  DocumentSegment,
  Requirement,
  Analysis,
  TestPlan,
  TestPlanRevision,
  TestCase,
  GeneratedArtifact,
  GenerationRun,
  ExecutionRun,
  TestResult,
  Finding,
  Approval,
  AuditEvent,
  ExecutionEvent,
  ExecutionLogEntry,
  Job,
  JobLogEntry,
  Notification,
  ProjectSequence,
  EventSubscription,
  UiScan,
  ScannedElement,
  LocatorRecord,
  UiScanLogEntry,
  StepLocatorReference,
};
