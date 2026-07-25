"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFICATION_TYPES = exports.EXECUTION_STAGES = exports.EXECUTION_LOG_LEVELS = exports.LOG_SEVERITIES = exports.APPROVAL_RESOURCE_TYPES = exports.FINDING_CLASSIFICATIONS = exports.CI_RUN_STATUSES = exports.RUN_SCOPES = exports.BROWSERS = exports.EXECUTION_STATUSES = exports.VALIDATION_STATUSES = exports.ARTEFACT_STATES = exports.JOB_STATUSES = exports.DOCUMENT_CATEGORIES = exports.SELF_REGISTER_ROLES = exports.ROLES = void 0;
exports.ROLES = [
    'admin',
    'qa_lead',
    'qa_engineer',
    'automation_engineer',
    'developer',
    'reviewer',
    'viewer',
    'supervisor',
    'devops',
];
exports.SELF_REGISTER_ROLES = [
    'qa_engineer',
    'automation_engineer',
    'developer',
    'reviewer',
    'viewer',
];
exports.DOCUMENT_CATEGORIES = [
    'user_story',
    'epic',
    'srs',
    'api_doc',
    'architecture',
];
exports.JOB_STATUSES = [
    'queued',
    'running',
    'awaiting_approval',
    'completed',
    'completed_with_warnings',
    'failed',
    'cancelled',
    'timed_out',
];
exports.ARTEFACT_STATES = [
    'draft',
    'under_review',
    'approved',
    'rejected',
    'superseded',
    'archived',
];
exports.VALIDATION_STATUSES = [
    'not_started',
    'pending',
    'running',
    'passed',
    'passed_with_warnings',
    'failed',
    'overridden',
];
exports.EXECUTION_STATUSES = [
    'queued',
    'preparing',
    'running',
    'stopping',
    'passed',
    'failed',
    'partially_passed',
    'cancelled',
    'timed_out',
    'completed',
    'error',
];
exports.BROWSERS = ['chromium', 'firefox', 'webkit'];
exports.RUN_SCOPES = ['selected', 'failed', 'all'];
exports.CI_RUN_STATUSES = [
    'not_triggered',
    'queued',
    'in_progress',
    'successful',
    'failed',
    'cancelled',
];
exports.FINDING_CLASSIFICATIONS = [
    'app_defect',
    'test_defect',
    'environment',
    'data',
    'flaky',
    'inconclusive',
    'unknown',
];
exports.APPROVAL_RESOURCE_TYPES = [
    'test_plan',
    'test_case',
    'automation',
    'validation_exception',
    'report',
];
exports.LOG_SEVERITIES = ['info', 'success', 'warning', 'error'];
exports.EXECUTION_LOG_LEVELS = [
    'debug',
    'info',
    'warning',
    'error',
    'success',
    'pass',
    'fail',
];
exports.EXECUTION_STAGES = [
    'Initializing',
    'Preparing Execution',
    'Loading Configuration',
    'Discovering Tests',
    'Launching Browser',
    'Running Tests',
    'Capturing Evidence',
    'Generating Reports',
    'Uploading Results',
    'Completed',
    'Failed',
];
exports.NOTIFICATION_TYPES = [
    'job.completed',
    'job.failed',
    'approval.requested',
    'execution.finished',
    'ci.result',
];
//# sourceMappingURL=enums.js.map