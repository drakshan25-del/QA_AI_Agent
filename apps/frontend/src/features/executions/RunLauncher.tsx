/**
 * Run Execution launcher (§23.3): browser engine selection (Chrome/Chromium,
 * Firefox, Safari-compatible WebKit — FR-V3-EXE-003), Headed/Headless modes
 * (FR-V3-EXE-002/004), run scope Selected/Failed/All (FR-V3-EXE-007) and
 * runtime settings within admin limits (FR-V3-EXE-011). Explains that a
 * headed browser opens on the execution host (FR-V3-EXE-014).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { executionsApi } from '../../services/api/endpoints';
import type {
  BrowserEngine,
  ExecutionSettings,
  RunScope,
} from '../../services/api/types';
import { Banner, Button, ErrorBanner, Select } from '../../components/ui';
import L from '../../styles/layout.module.css';

const BROWSER_LABELS: Array<{ value: BrowserEngine; label: string }> = [
  { value: 'chromium', label: 'Chrome (Chromium engine)' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'webkit', label: 'Safari (WebKit engine)' },
];

export function RunLauncher({
  projectId,
  automationIds,
  disabled,
  disabledReason,
}: {
  projectId: string;
  automationIds: string[];
  disabled?: boolean;
  disabledReason?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const [browser, setBrowser] = useState<BrowserEngine>('chromium');
  const [headed, setHeaded] = useState(false);
  const [runScope, setRunScope] = useState<RunScope>('selected');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [settings, setSettings] = useState<ExecutionSettings>({
    timeoutSeconds: 900,
    retries: 0,
    workers: 1,
    slowMoMs: 0,
    screenshotMode: 'on-failure',
    video: false,
  });

  const run = useMutation({
    mutationFn: () =>
      executionsApi.create({
        projectId,
        automationIds: runScope === 'selected' ? automationIds : undefined,
        browser,
        headed,
        runScope,
        settings,
      }),
    onSuccess: (res) => navigate(`/executions/${res.id}`),
  });

  const setNum = (key: keyof ExecutionSettings) => (value: string) =>
    setSettings((prev) => ({ ...prev, [key]: parseInt(value, 10) || 0 }));

  return (
    <div className={L.stack} style={{ gap: 8 }}>
      <div className={L.row} style={{ flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
        <Select
          label="Browser (FR-V3-EXE-003)"
          value={browser}
          onChange={(e) => setBrowser(e.target.value as BrowserEngine)}
        >
          {BROWSER_LABELS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </Select>
        <Select
          label="Mode"
          value={headed ? 'headed' : 'headless'}
          onChange={(e) => setHeaded(e.target.value === 'headed')}
        >
          <option value="headless">Headless</option>
          <option value="headed">Headed (visible browser)</option>
        </Select>
        <Select
          label="Scope (FR-V3-EXE-007)"
          value={runScope}
          onChange={(e) => setRunScope(e.target.value as RunScope)}
        >
          <option value="selected">Run selected ({automationIds.length})</option>
          <option value="failed">Run failed tests (last run)</option>
          <option value="all">Run all approved tests</option>
        </Select>
        <Button small variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? 'Hide settings' : 'Settings'}
        </Button>
        <Button
          variant="primary"
          loading={run.isPending}
          disabled={disabled || (runScope === 'selected' && automationIds.length === 0)}
          title={disabled ? disabledReason : undefined}
          onClick={() => run.mutate()}
        >
          Run Execution
        </Button>
      </div>

      {showAdvanced && (
        <div className={L.row} style={{ flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
          <label>
            <span className={L.muted} style={{ display: 'block', fontSize: 12 }}>
              Timeout (s)
            </span>
            <input
              type="number"
              min={30}
              aria-label="Timeout seconds"
              value={settings.timeoutSeconds}
              onChange={(e) => setNum('timeoutSeconds')(e.target.value)}
              style={{ width: 90 }}
            />
          </label>
          <label>
            <span className={L.muted} style={{ display: 'block', fontSize: 12 }}>
              Retries
            </span>
            <input
              type="number"
              min={0}
              max={10}
              aria-label="Retries per failed test"
              value={settings.retries}
              onChange={(e) => setNum('retries')(e.target.value)}
              style={{ width: 70 }}
            />
          </label>
          <label>
            <span className={L.muted} style={{ display: 'block', fontSize: 12 }}>
              Workers
            </span>
            <input
              type="number"
              min={1}
              max={16}
              aria-label="Parallel workers"
              value={settings.workers}
              onChange={(e) => setNum('workers')(e.target.value)}
              style={{ width: 70 }}
            />
          </label>
          <label>
            <span className={L.muted} style={{ display: 'block', fontSize: 12 }}>
              Slow-mo (ms)
            </span>
            <input
              type="number"
              min={0}
              aria-label="Slow motion milliseconds"
              value={settings.slowMoMs}
              onChange={(e) => setNum('slowMoMs')(e.target.value)}
              style={{ width: 90 }}
            />
          </label>
          <Select
            label="Screenshots"
            value={settings.screenshotMode}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                screenshotMode: e.target
                  .value as ExecutionSettings['screenshotMode'],
              }))
            }
          >
            <option value="on-failure">On failure</option>
            <option value="every-test">After every test</option>
            <option value="off">Off</option>
          </Select>
          <label className={L.row} style={{ gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              aria-label="Record video"
              checked={!!settings.video}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, video: e.target.checked }))
              }
            />
            <span>Video</span>
          </label>
        </div>
      )}

      {headed && (
        <Banner kind="info">
          Headed mode opens a visible browser window on the execution host (the
          machine running the QA engine). If the engine runs remotely or in CI
          without an interactive desktop session, no window can appear there
          (FR-V3-EXE-014).
        </Banner>
      )}
      {run.isError && <ErrorBanner error={run.error} />}
    </div>
  );
}
