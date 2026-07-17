import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { documentsApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import type { DocumentSegment } from '../services/api/types';
import { humanCategory } from '../lib/format';
import L from '../styles/layout.module.css';

export function DocumentPreviewPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.documentPreview(id),
    queryFn: () => documentsApi.preview(id),
    enabled: !!id,
  });

  // Local inclusion state, seeded from the server, saved on demand.
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (q.data) {
      const next: Record<string, boolean> = {};
      for (const seg of q.data.segments) next[seg.id] = seg.inclusionStatus !== 'excluded';
      setIncluded(next);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: (segments: DocumentSegment[]) =>
      documentsApi.updateSegments(
        id,
        segments.map((seg) => ({
          id: seg.id,
          inclusionStatus: included[seg.id] === false ? 'excluded' : 'included',
        })),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.documentPreview(id) }),
  });

  return (
    <div className={L.stack}>
      <PageHeader
        title="Document preview"
        subtitle="Toggle which segments feed downstream generation (FR-IN-009)"
      />
      <QueryState query={q} loadingLabel="Loading preview…">
        {(data) => {
          const includedCount = data.segments.filter((seg) => included[seg.id] !== false).length;
          return (
            <>
              <Card
                title={data.document.filename}
                subtitle={`${humanCategory(data.document.category)} · ${data.segments.length} segments · ${includedCount} included`}
                actions={
                  <div className={L.row}>
                    <StatusBadge
                      status={data.document.parseStatus}
                      label={`parse: ${data.document.parseStatus}`}
                    />
                    <Link to={`/projects/${data.document.projectId}/upload`}>
                      <Button small variant="ghost">
                        Back to uploads
                      </Button>
                    </Link>
                  </div>
                }
              >
                {save.isError && <ErrorBanner error={save.error} />}
                {save.isSuccess && <Banner kind="success">Segment selections saved.</Banner>}
                {data.document.message && <Banner kind="warn">{data.document.message}</Banner>}
                <div className={L.row} style={{ marginTop: 8 }}>
                  <Button
                    small
                    onClick={() =>
                      setIncluded(Object.fromEntries(data.segments.map((s) => [s.id, true])))
                    }
                  >
                    Include all
                  </Button>
                  <Button
                    small
                    onClick={() =>
                      setIncluded(Object.fromEntries(data.segments.map((s) => [s.id, false])))
                    }
                  >
                    Exclude all
                  </Button>
                  <div className={L.spacer} />
                  <Button
                    variant="primary"
                    loading={save.isPending}
                    onClick={() => save.mutate(data.segments)}
                  >
                    Save selections
                  </Button>
                </div>
              </Card>

              <Card title="Segments">
                {data.segments.length === 0 ? (
                  <p className={L.muted}>No segments were parsed from this document.</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {data.segments.map((seg) => {
                      const on = included[seg.id] !== false;
                      return (
                        <li
                          key={seg.id}
                          style={{
                            padding: '10px 0',
                            borderBottom: '1px solid var(--border)',
                            opacity: on ? 1 : 0.55,
                          }}
                        >
                          <label className={L.row} style={{ alignItems: 'flex-start' }}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) =>
                                setIncluded((prev) => ({ ...prev, [seg.id]: e.target.checked }))
                              }
                              style={{ marginTop: 3 }}
                            />
                            <span style={{ flex: 1 }}>
                              <span className={L.muted} style={{ fontSize: 12 }}>
                                #{seg.sequence}
                                {seg.pageOrSheet ? ` · ${seg.pageOrSheet}` : ''}
                                {seg.rowOrSection ? ` · ${seg.rowOrSection}` : ''}
                              </span>
                              {/* Rendered as escaped text — never as HTML (FR-FE-006, SEC-004). */}
                              <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>
                                {seg.content}
                              </div>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
