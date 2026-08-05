/**
 * Scan artefacts: the page screenshot and the ARIA snapshot (FR-UIS-019/020).
 *
 * Both are fetched through the authenticated API client rather than a bare
 * `<img src>`, because the artefact endpoints require the bearer token and
 * verify project membership before serving a byte.
 *
 * Selecting an element in the results table draws its bounding box over the
 * screenshot. The original image is never modified — the highlight is an
 * overlay scaled to however the image is currently rendered.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { http } from '../../services/api/client';
import { uiScannerApi } from '../../services/api/endpoints';
import type { ScannedElement, UiScan } from '../../services/api/types';
import { downloadText } from './exporters';
import L from '../../styles/layout.module.css';
import s from './uiScanner.module.css';

export function ScanScreenshot({
  projectId,
  scan,
  highlighted,
}: {
  projectId: string;
  scan: UiScan;
  highlighted: ScannedElement | null;
}): JSX.Element | null {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!scan.screenshotFile) return;
    let objectUrl = '';
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const response = await http.get(
          uiScannerApi.screenshotUrl(projectId, scan.id),
          { responseType: 'blob' },
        );
        if (cancelled) return;
        objectUrl = URL.createObjectURL(response.data as Blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setError('The screenshot could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, scan.id, scan.screenshotFile]);

  // The bounding box is in page pixels; scale it to the rendered image size.
  const box = useMemo(() => {
    const position = highlighted?.position;
    if (!position || !natural || !rendered || !natural.w) return null;
    const scale = rendered.w / natural.w;
    return {
      left: (position.x ?? 0) * scale,
      top: (position.y ?? 0) * scale,
      width: Math.max(2, (position.width ?? 0) * scale),
      height: Math.max(2, (position.height ?? 0) * scale),
    };
  }, [highlighted, natural, rendered]);

  if (!scan.screenshotFile) {
    return (
      <Card title="Page screenshot">
        <p className={L.muted} style={{ margin: 0 }}>
          This scan has no screenshot. Enable “Include page screenshot” and
          re-scan to capture one.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Page screenshot"
      subtitle={
        highlighted
          ? `Highlighting ${highlighted.accessibleName || highlighted.elementKey}` +
            (highlighted.position
              ? ` at x ${highlighted.position.x}, y ${highlighted.position.y}`
              : '')
          : 'Expand an element in the results table to highlight it here'
      }
    >
      {loading && <Spinner label="Loading screenshot" />}
      {error && <p className={L.muted}>{error}</p>}
      {src && (
        <div className={s.shotWrap}>
          <div className={s.shotFrame}>
            <img
              ref={imgRef}
              className={s.shot}
              src={src}
              alt={`Full-page screenshot of ${scan.finalUrl || scan.url}`}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                setRendered({ w: img.clientWidth, h: img.clientHeight });
              }}
            />
            {box && (
              <div
                className={s.highlight}
                style={{
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                }}
              />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function AccessibilitySnapshotViewer({
  projectId,
  scan,
}: {
  projectId: string;
  scan: UiScan;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || snapshot || !scan.accessibilitySnapshotFile) return;
    setLoading(true);
    void uiScannerApi
      .accessibilitySnapshot(projectId, scan.id)
      .then((text) => setSnapshot(text))
      .catch(() => setError('The accessibility snapshot could not be loaded.'))
      .finally(() => setLoading(false));
  }, [open, snapshot, projectId, scan.id, scan.accessibilitySnapshotFile]);

  const lines = useMemo(() => {
    if (!query.trim()) return snapshot.split('\n');
    const needle = query.toLowerCase();
    return snapshot.split('\n').filter((line) => line.toLowerCase().includes(needle));
  }, [snapshot, query]);

  if (!scan.accessibilitySnapshotFile) {
    return (
      <Card title="Accessibility snapshot">
        <p className={L.muted} style={{ margin: 0 }}>
          This scan has no accessibility snapshot. Enable “Include accessibility
          snapshot” and re-scan to capture one.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Accessibility snapshot"
      subtitle="Playwright's own view of the accessibility tree — the authority on accessible names"
      actions={
        <div className={s.controls}>
          <Button small variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? 'Collapse' : 'Expand'}
          </Button>
          {open && snapshot && (
            <>
              <Button
                small
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(snapshot);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* clipboard blocked — download still works */
                  }
                }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <Button
                small
                variant="ghost"
                onClick={() =>
                  downloadText(
                    `ui-scan-${scan.id.slice(0, 8)}-aria.yaml`,
                    snapshot,
                    'text/yaml;charset=utf-8',
                  )
                }
              >
                Download
              </Button>
            </>
          )}
        </div>
      }
    >
      {open && (
        <>
          <input
            aria-label="Search the accessibility snapshot"
            placeholder="Search the tree…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: 8, width: '100%', maxWidth: 320 }}
          />
          {loading && <Spinner label="Loading snapshot" />}
          {error && <p className={L.muted}>{error}</p>}
          {snapshot && (
            <pre className={s.snapshot}>
              {lines.length ? lines.join('\n') : 'No line matches that search.'}
            </pre>
          )}
        </>
      )}
    </Card>
  );
}
