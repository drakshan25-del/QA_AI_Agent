"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventSubscription = exports.ProjectSequence = exports.Notification = exports.JobLogEntry = exports.Job = exports.ExecutionLogEntry = exports.ExecutionEvent = exports.AuditEvent = exports.Approval = exports.Finding = exports.TestResult = exports.ExecutionRun = exports.GenerationRun = exports.GeneratedArtifact = exports.TestCase = exports.TestPlanRevision = exports.TestPlan = exports.Analysis = exports.Requirement = exports.DocumentSegment = exports.SourceDocument = exports.ProjectMember = exports.Project = exports.User = exports.ALL_ENTITIES = void 0;
const user_entity_1 = require("./user.entity");
Object.defineProperty(exports, "User", { enumerable: true, get: function () { return user_entity_1.User; } });
const project_entity_1 = require("./project.entity");
Object.defineProperty(exports, "Project", { enumerable: true, get: function () { return project_entity_1.Project; } });
const project_member_entity_1 = require("./project-member.entity");
Object.defineProperty(exports, "ProjectMember", { enumerable: true, get: function () { return project_member_entity_1.ProjectMember; } });
const source_document_entity_1 = require("./source-document.entity");
Object.defineProperty(exports, "SourceDocument", { enumerable: true, get: function () { return source_document_entity_1.SourceDocument; } });
const document_segment_entity_1 = require("./document-segment.entity");
Object.defineProperty(exports, "DocumentSegment", { enumerable: true, get: function () { return document_segment_entity_1.DocumentSegment; } });
const requirement_entity_1 = require("./requirement.entity");
Object.defineProperty(exports, "Requirement", { enumerable: true, get: function () { return requirement_entity_1.Requirement; } });
const analysis_entity_1 = require("./analysis.entity");
Object.defineProperty(exports, "Analysis", { enumerable: true, get: function () { return analysis_entity_1.Analysis; } });
const test_plan_entity_1 = require("./test-plan.entity");
Object.defineProperty(exports, "TestPlan", { enumerable: true, get: function () { return test_plan_entity_1.TestPlan; } });
const test_plan_revision_entity_1 = require("./test-plan-revision.entity");
Object.defineProperty(exports, "TestPlanRevision", { enumerable: true, get: function () { return test_plan_revision_entity_1.TestPlanRevision; } });
const test_case_entity_1 = require("./test-case.entity");
Object.defineProperty(exports, "TestCase", { enumerable: true, get: function () { return test_case_entity_1.TestCase; } });
const generated_artifact_entity_1 = require("./generated-artifact.entity");
Object.defineProperty(exports, "GeneratedArtifact", { enumerable: true, get: function () { return generated_artifact_entity_1.GeneratedArtifact; } });
const generation_run_entity_1 = require("./generation-run.entity");
Object.defineProperty(exports, "GenerationRun", { enumerable: true, get: function () { return generation_run_entity_1.GenerationRun; } });
const execution_run_entity_1 = require("./execution-run.entity");
Object.defineProperty(exports, "ExecutionRun", { enumerable: true, get: function () { return execution_run_entity_1.ExecutionRun; } });
const test_result_entity_1 = require("./test-result.entity");
Object.defineProperty(exports, "TestResult", { enumerable: true, get: function () { return test_result_entity_1.TestResult; } });
const finding_entity_1 = require("./finding.entity");
Object.defineProperty(exports, "Finding", { enumerable: true, get: function () { return finding_entity_1.Finding; } });
const approval_entity_1 = require("./approval.entity");
Object.defineProperty(exports, "Approval", { enumerable: true, get: function () { return approval_entity_1.Approval; } });
const audit_event_entity_1 = require("./audit-event.entity");
Object.defineProperty(exports, "AuditEvent", { enumerable: true, get: function () { return audit_event_entity_1.AuditEvent; } });
const execution_event_entity_1 = require("./execution-event.entity");
Object.defineProperty(exports, "ExecutionEvent", { enumerable: true, get: function () { return execution_event_entity_1.ExecutionEvent; } });
const execution_log_entry_entity_1 = require("./execution-log-entry.entity");
Object.defineProperty(exports, "ExecutionLogEntry", { enumerable: true, get: function () { return execution_log_entry_entity_1.ExecutionLogEntry; } });
const job_entity_1 = require("./job.entity");
Object.defineProperty(exports, "Job", { enumerable: true, get: function () { return job_entity_1.Job; } });
const job_log_entry_entity_1 = require("./job-log-entry.entity");
Object.defineProperty(exports, "JobLogEntry", { enumerable: true, get: function () { return job_log_entry_entity_1.JobLogEntry; } });
const notification_entity_1 = require("./notification.entity");
Object.defineProperty(exports, "Notification", { enumerable: true, get: function () { return notification_entity_1.Notification; } });
const project_sequence_entity_1 = require("./project-sequence.entity");
Object.defineProperty(exports, "ProjectSequence", { enumerable: true, get: function () { return project_sequence_entity_1.ProjectSequence; } });
const event_subscription_entity_1 = require("./event-subscription.entity");
Object.defineProperty(exports, "EventSubscription", { enumerable: true, get: function () { return event_subscription_entity_1.EventSubscription; } });
exports.ALL_ENTITIES = [
    user_entity_1.User,
    project_entity_1.Project,
    project_member_entity_1.ProjectMember,
    source_document_entity_1.SourceDocument,
    document_segment_entity_1.DocumentSegment,
    requirement_entity_1.Requirement,
    analysis_entity_1.Analysis,
    test_plan_entity_1.TestPlan,
    test_plan_revision_entity_1.TestPlanRevision,
    test_case_entity_1.TestCase,
    generated_artifact_entity_1.GeneratedArtifact,
    generation_run_entity_1.GenerationRun,
    execution_run_entity_1.ExecutionRun,
    test_result_entity_1.TestResult,
    finding_entity_1.Finding,
    approval_entity_1.Approval,
    audit_event_entity_1.AuditEvent,
    execution_event_entity_1.ExecutionEvent,
    execution_log_entry_entity_1.ExecutionLogEntry,
    job_entity_1.Job,
    job_log_entry_entity_1.JobLogEntry,
    notification_entity_1.Notification,
    project_sequence_entity_1.ProjectSequence,
    event_subscription_entity_1.EventSubscription,
];
//# sourceMappingURL=index.js.map