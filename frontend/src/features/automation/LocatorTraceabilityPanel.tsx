/**
 * Locator provenance for a generated automation file (FR-UIS-025 §10).
 *
 * For every locator-based step the reviewer can see what the code is bound to:
 * the element, the scanned page, the strategy, the exact expression, where the
 * locator came from, both confidences, its validation status, its version, when
 * it was last validated, and a link into the UI Scanner.
 *
 * What is never shown here: anything about the target application's session.
 * No password, cookie, token or storage state reaches this component, because
 * none of it reaches the API that feeds it (§16, §10).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui/Card';
import { Banner } from '../../components/ui/Banner';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { LocatorCode } from '../ui-scanner/LocatorCode';
import { automationApi } from '../../services/api/endpoints';
import { qk } from '../../services/api/queryKeys';
import type {
  GeneratedArtifact,
  LocatorResolutionSource,
  StepLocatorReference,
  UnresolvedStep,
} from '../../services/api/types';
import L from '../../styles/layout.module.css';
import s from './automation.module.css';

const SOURCE_LABEL: Record<LocatorResolutionSource, string> = {
  DETERMINISTIC_SCANNER: 'UI Scanner',
  LLM_FALLBACK: 'UI Scanner (model-matched step)',
  MANUAL_EDIT: 'UI Scanner (manually edited)',
};

/** Validation verdicts that mean the locator resolved exactly one element. */
const GOOD_VALIDATION = ['unique', 'approved', 'valid'];

function percent(value: number): string {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return 'never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'never' : date.toLocaleString();
}

function LocatorRow({
  reference,
  projectId,
}: {
  reference: StepLocatorReference;
  projectId: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const valid = GOOD_VALIDATION.includes(reference.validationStatus);
  return (
    <>
      <tr>
        <td className={s.cell}>
          <button
            type="button"
            className={s.disclosure}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {/* Decorative: the accessible name is the element name alone. */}
            <span aria-hidden="true">{open ? '▾' : '▸'} </span>
            {reference.elementName || '(unnamed element)'}
          </button>
        </td>
        <td className={s.cell}>{reference.pageName || reference.pageUrlPattern}</td>
        <td className={s.cell}>{reference.strategy}</td>
        <td className={s.cell}>
          <StatusBadge
            status={reference.source === 'DETERMINISTIC_SCANNER' ? 'approved' : 'pending'}
            label={SOURCE_LABEL[reference.source] ?? reference.source}
          />
        </td>
        <td className={s.cell}>{percent(reference.locatorConfidence)}</td>
        <td className={s.cell}>{percent(reference.elementMatchConfidence)}</td>
        <td className={s.cell}>
          <StatusBadge
            status={valid ? 'passed' : 'failed'}
            label={valid ? 'Valid and unique' : reference.validationStatus}
          />
        </td>
        <td className={s.cell}>v{reference.locatorVersion}</td>
      </tr>
      {open && (
        <tr>
          <td className={s.cell} colSpan={8}>
            <div className={L.stack} style={{ gap: 8 }}>
              <div className={L.muted} style={{ fontSize: 12 }}>
                Test step {reference.stepSequence}: {reference.testStepText}
              </div>
              <LocatorCode code={reference.generatedExpression} />
              <div className={L.row} style={{ gap: 16, fontSize: 12 }}>
                <span className={L.muted}>
                  Last validated: {formatDate(reference.validatedAt)}
                </span>
                <span className={L.muted}>Locator id: {reference.locatorId}</span>
                {reference.scanId && (
                  <Link
                    to={`/projects/${projectId}/analysis?tab=ui-scanner&scan=${reference.scanId}&element=${reference.scannedElementId}`}
                  >
                    Open in UI Scanner
                  </Link>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Steps no approved locator covered.
 *
 * Informational only: approval of a locator is final, and a gap in scan
 * coverage never blocks approval or execution (§2, §5). It is shown so the
 * user knows which page still needs scanning.
 */
function UnmatchedList({ steps }: { steps: UnresolvedStep[] }): JSX.Element {
  return (
    <Banner kind="info">
      <div>
        <strong>
          No approved locator matched {steps.length} test step
          {steps.length === 1 ? '' : 's'}.
        </strong>{' '}
        Those steps were left out of the generated test; the rest still run.
        Scan the page they act on and approve its locators to cover them.
      </div>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {steps.map((step) => (
          <li key={step.testStepId} style={{ marginBottom: 6 }}>
            <div>&ldquo;{step.testStep}&rdquo;</div>
            <div className={L.muted} style={{ fontSize: 12 }}>
              {step.reason} {step.suggestedAction}
            </div>
          </li>
        ))}
      </ul>
    </Banner>
  );
}

export function LocatorTraceabilityPanel({
  artifact,
  projectId,
}: {
  artifact: GeneratedArtifact;
  projectId: string;
}): JSX.Element | null {
  const traceability = (artifact.traceability ?? {}) as Record<string, unknown>;
  // `unresolvedSteps` is the field name older artefacts used for the same
  // diagnostic; both are read so historical files still explain themselves.
  const unmatched =
    (traceability.unmatchedSteps as UnresolvedStep[] | undefined) ??
    (traceability.unresolvedSteps as UnresolvedStep[] | undefined) ??
    [];
  const references = useQuery({
    queryKey: qk.automationLocators(artifact.id),
    queryFn: () => automationApi.locatorReferences(artifact.id),
  });

  const rows = references.data ?? [];
  if (!rows.length && !unmatched.length && !references.isLoading) {
    // Nothing to report: an artefact with no UI interactions at all (a fixture
    // or a pure navigation test) should not grow an empty panel.
    return null;
  }
  // A test file that delegates to a page object holds no locator itself; the
  // rows then describe the page object generated with it, and saying so is
  // more useful than showing an empty table.
  const viaPageObject =
    rows.length > 0 && rows.every((row) => row.generatedFileId !== artifact.id);

  // The result follows from what generation actually did — every step covered
  // by an approved locator reads "Approved" (§4). It is never hardcoded, and
  // there is no review status to report.
  const validation =
    (traceability.locatorValidation as string | undefined) ??
    (rows.length > 0 && unmatched.length === 0
      ? 'approved'
      : rows.length > 0
        ? 'partial'
        : 'none');
  const validationLabel =
    validation === 'approved'
      ? 'Approved'
      : validation === 'partial'
        ? `Approved for ${rows.length} of ${rows.length + unmatched.length} steps`
        : 'No approved locator matched';

  return (
    <Card
      title="Locator sources"
      subtitle={
        rows.length
          ? `${rows.length} generated interaction${rows.length === 1 ? '' : 's'} traced to UI Scanner locators` +
            (viaPageObject ? ", through this suite's page objects" : '')
          : 'No UI Scanner locator is used by this file'
      }
      actions={
        <StatusBadge
          status={validation === 'approved' ? 'approved' : 'pending'}
          label={`Locator validation: ${validationLabel}`}
        />
      }
    >
      {unmatched.length > 0 && <UnmatchedList steps={unmatched} />}
      {references.isLoading && <p className={L.muted}>Loading locator sources…</p>}
      {!references.isLoading && rows.length === 0 && !unmatched.length && (
        <Banner kind="warn">
          This file contains no scanner-validated locator. Run a UI scan, approve
          its locators and regenerate.
        </Banner>
      )}
      {rows.length > 0 && (
        <div className={s.tableWrap} style={{ marginTop: unmatched.length ? 10 : 0 }}>
          <table className={s.locatorTable}>
            <thead>
              <tr>
                <th>Element</th>
                <th>Scanned page</th>
                <th>Strategy</th>
                <th>Source</th>
                <th>Locator</th>
                <th>Step match</th>
                <th>Validation</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((reference) => (
                <LocatorRow
                  key={reference.id}
                  reference={reference}
                  projectId={projectId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
