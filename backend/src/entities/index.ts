import { User } from './user.entity';
import { Project } from './project.entity';
import { ProjectMember } from './project-member.entity';
import { SourceDocument } from './source-document.entity';
import { DocumentSegment } from './document-segment.entity';
import { Requirement } from './requirement.entity';
import { Analysis } from './analysis.entity';
import { TestPlan } from './test-plan.entity';
import { TestCase } from './test-case.entity';
import { GeneratedArtifact } from './generated-artifact.entity';
import { GenerationRun } from './generation-run.entity';
import { ExecutionRun } from './execution-run.entity';
import { TestResult } from './test-result.entity';
import { Finding } from './finding.entity';
import { Approval } from './approval.entity';
import { AuditEvent } from './audit-event.entity';
import { ExecutionEvent } from './execution-event.entity';
import { Job } from './job.entity';
import { EventSubscription } from './event-subscription.entity';

export const ALL_ENTITIES = [
  User,
  Project,
  ProjectMember,
  SourceDocument,
  DocumentSegment,
  Requirement,
  Analysis,
  TestPlan,
  TestCase,
  GeneratedArtifact,
  GenerationRun,
  ExecutionRun,
  TestResult,
  Finding,
  Approval,
  AuditEvent,
  ExecutionEvent,
  Job,
  EventSubscription,
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
  TestCase,
  GeneratedArtifact,
  GenerationRun,
  ExecutionRun,
  TestResult,
  Finding,
  Approval,
  AuditEvent,
  ExecutionEvent,
  Job,
  EventSubscription,
};
