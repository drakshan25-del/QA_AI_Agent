"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CI_RUN_TRANSITIONS = exports.VALIDATION_TRANSITIONS = exports.EXECUTION_TRANSITIONS = exports.JOB_TRANSITIONS = void 0;
exports.canTransition = canTransition;
exports.assertTransition = assertTransition;
exports.isTerminalJobStatus = isTerminalJobStatus;
exports.isTerminalExecutionStatus = isTerminalExecutionStatus;
exports.deriveArtefactState = deriveArtefactState;
exports.outcomeFromMetrics = outcomeFromMetrics;
const errors_1 = require("./errors");
exports.JOB_TRANSITIONS = {
    queued: ['running', 'cancelled'],
    running: [
        'awaiting_approval',
        'completed',
        'completed_with_warnings',
        'failed',
        'cancelled',
        'timed_out',
    ],
    awaiting_approval: ['completed', 'completed_with_warnings', 'cancelled'],
    completed: [],
    completed_with_warnings: [],
    failed: [],
    cancelled: [],
    timed_out: [],
};
exports.EXECUTION_TRANSITIONS = {
    queued: ['preparing', 'running', 'cancelled', 'error', 'failed'],
    preparing: ['running', 'cancelled', 'failed', 'error', 'timed_out'],
    running: [
        'stopping',
        'passed',
        'failed',
        'partially_passed',
        'cancelled',
        'timed_out',
        'completed',
        'error',
    ],
    stopping: ['cancelled', 'failed', 'passed', 'partially_passed'],
    passed: [],
    failed: [],
    partially_passed: [],
    cancelled: [],
    timed_out: [],
    completed: [],
    error: [],
};
exports.VALIDATION_TRANSITIONS = {
    not_started: ['running'],
    pending: ['running'],
    running: ['passed', 'passed_with_warnings', 'failed'],
    passed: ['running', 'overridden'],
    passed_with_warnings: ['running', 'overridden'],
    failed: ['running', 'overridden'],
    overridden: ['running'],
};
exports.CI_RUN_TRANSITIONS = {
    not_triggered: ['queued', 'in_progress'],
    queued: ['in_progress', 'cancelled'],
    in_progress: ['successful', 'failed', 'cancelled'],
    successful: [],
    failed: [],
    cancelled: [],
};
function canTransition(map, from, to) {
    if (from === to)
        return true;
    return (map[from] ?? []).includes(to);
}
function assertTransition(map, entity, from, to) {
    if (!canTransition(map, from, to)) {
        throw new errors_1.ConflictAppException(`Invalid ${entity} state transition: ${from} → ${to}.`, 'invalid_state_transition', { entity, from, to, allowed: map[from] ?? [] });
    }
}
function isTerminalJobStatus(status) {
    return exports.JOB_TRANSITIONS[status]?.length === 0;
}
function isTerminalExecutionStatus(status) {
    return exports.EXECUTION_TRANSITIONS[status]?.length === 0;
}
function deriveArtefactState(entity) {
    if (entity.archived)
        return 'archived';
    if (entity.status === 'superseded')
        return 'superseded';
    if (entity.approvalStatus === 'approved' && !entity.approvalInvalidated) {
        return 'approved';
    }
    if (entity.approvalStatus === 'rejected')
        return 'rejected';
    if (entity.approvalInvalidated)
        return 'under_review';
    return entity.approvalStatus === 'pending' ? 'under_review' : 'draft';
}
function outcomeFromMetrics(metrics) {
    const passed = metrics.passed ?? 0;
    const failed = (metrics.failed ?? 0) + (metrics.errors ?? 0);
    if (passed === 0 && failed === 0)
        return 'failed';
    if (failed === 0)
        return 'passed';
    if (passed === 0)
        return 'failed';
    return 'partially_passed';
}
//# sourceMappingURL=state-machines.js.map