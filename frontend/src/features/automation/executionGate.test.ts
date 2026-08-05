/**
 * What may and may not stop a generated suite from running (FR-UIS-025 §5).
 *
 * The rule this file exists to protect: a user's approval of a locator is
 * final, so locator *warnings* never disable Run. Only conditions that make
 * execution genuinely impossible do. Every legacy review signal is covered
 * here, because those were what used to block a perfectly runnable file.
 */
import { describe, expect, it } from 'vitest';
import { executionGate } from './executionGate';
import type { GeneratedArtifact } from '../../services/api/types';

type GateArtifact = Parameters<typeof executionGate>[0]['artifact'];

function artifact(overrides: Partial<GeneratedArtifact> = {}): GateArtifact {
  return {
    content: 'def test_login(page):\n    pass\n',
    status: 'active',
    approvalStatus: 'approved',
    validationStatus: 'passed',
    ...overrides,
  } as GateArtifact;
}

describe('execution gate', () => {
  describe('warnings never block', () => {
    it('runs an approved, validated file', () => {
      expect(executionGate({ artifact: artifact() }).enabled).toBe(true);
    });

    it('runs when validation passed with warnings', () => {
      const gate = executionGate({
        artifact: artifact({ validationStatus: 'passed_with_warnings' }),
      });
      expect(gate.enabled).toBe(true);
    });

    it('runs when a governed validation override is in force', () => {
      expect(
        executionGate({ artifact: artifact({ validationStatus: 'overridden' }) }).enabled,
      ).toBe(true);
    });

    it('ignores a legacy review flag left in old traceability', () => {
      // Artefacts generated before the review stage was removed still carry
      // these fields; they must not reappear as a gate (§6).
      const legacy = {
        ...artifact(),
        traceability: {
          reviewRequired: true,
          unresolvedSteps: [{ testStep: 'Click Confirm' }],
        },
      } as GateArtifact;
      expect(executionGate({ artifact: legacy }).enabled).toBe(true);
    });

    it('ignores a step with no approved locator match', () => {
      const withGap = {
        ...artifact(),
        traceability: { locatorValidation: 'partial', unmatchedStepCount: 2 },
      } as GateArtifact;
      expect(executionGate({ artifact: withGap }).enabled).toBe(true);
    });
  });

  describe('genuine blockers', () => {
    it('blocks when no automation script exists', () => {
      const gate = executionGate({ artifact: null });
      expect(gate.enabled).toBe(false);
      expect(gate.reason).toMatch(/no automation script/i);
    });

    it('blocks when the script is empty', () => {
      const gate = executionGate({ artifact: artifact({ content: '   \n' }) });
      expect(gate.enabled).toBe(false);
      expect(gate.reason).toMatch(/empty/i);
    });

    it('blocks while generation is still running', () => {
      const gate = executionGate({ artifact: artifact(), generating: true });
      expect(gate.enabled).toBe(false);
      expect(gate.reason).toMatch(/generation/i);
    });

    it('blocks while another execution is in flight', () => {
      const gate = executionGate({ artifact: artifact(), executing: true });
      expect(gate.enabled).toBe(false);
      expect(gate.reason).toMatch(/already running/i);
    });

    it('blocks a superseded version', () => {
      const gate = executionGate({ artifact: artifact({ status: 'superseded' }) });
      expect(gate.enabled).toBe(false);
    });

    it('blocks until the file is approved', () => {
      const gate = executionGate({ artifact: artifact({ approvalStatus: 'pending' }) });
      expect(gate.enabled).toBe(false);
      expect(gate.reason).toMatch(/approved/i);
    });

    it('blocks on a failed validation', () => {
      const gate = executionGate({ artifact: artifact({ validationStatus: 'failed' }) });
      expect(gate.enabled).toBe(false);
      expect(gate.reason).toMatch(/validation/i);
    });
  });

  describe('the reason never mentions a review', () => {
    it.each([
      artifact({ approvalStatus: 'pending' }),
      artifact({ validationStatus: 'failed' }),
      artifact({ content: '' }),
    ])('for %#', (input) => {
      expect(executionGate({ artifact: input }).reason).not.toMatch(/review/i);
    });
  });
});
