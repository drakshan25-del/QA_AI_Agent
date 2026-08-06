import type { TimelineStep } from './executionTimeline';

/**
 * Plain-language label for a step (NFR-USA-005). The technical target/value is
 * shown separately in an expandable detail row so non-technical reviewers can
 * follow the run without reading selectors.
 */
export function plainLabel(step: TimelineStep): string {
  const t = step.target || 'the page';
  switch (step.actionType) {
    case 'navigate':
      return `Opened ${step.target || 'the application'}`;
    case 'click':
      return `Clicked ${t}`;
    case 'fill':
      return `Entered a value into ${t}`;
    case 'select':
      return `Selected an option in ${t}`;
    case 'upload':
      return `Uploaded a file to ${t}`;
    case 'wait':
      return `Waited for ${t}`;
    case 'assert':
      return `Checked that ${t} is as expected`;
    case 'screenshot':
      return `Captured a screenshot`;
    case 'error':
      return `Encountered an error`;
    default:
      return step.actionType ? `${step.actionType} ${t}` : 'Step';
  }
}
