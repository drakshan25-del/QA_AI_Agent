import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Progress } from '../components/ui/Progress';
import { TextInput, TextArea } from '../components/ui/Field';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { Dropzone } from '../features/uploads/Dropzone';
import { useUploadQueue } from '../features/uploads/useUploadQueue';
import { useProjectId } from '../features/projects/hooks';
import { documentsApi, requirementsApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import { DOCUMENT_CATEGORIES, type DocumentCategory } from '../services/api/types';
import { formatBytes, formatRelative, humanCategory } from '../lib/format';
import s from '../features/uploads/uploads.module.css';
import L from '../styles/layout.module.css';

function UploadQueue({ projectId }: { projectId: string }): JSX.Element {
  const qc = useQueryClient();
  const [defaultCategory, setDefaultCategory] = useState<DocumentCategory>('user_story');
  const queue = useUploadQueue(projectId, () => {
    void qc.invalidateQueries({ queryKey: qk.documents(projectId) });
    void qc.invalidateQueries({ queryKey: qk.project(projectId) });
  });

  const pending = queue.items.filter((i) => i.status === 'queued').length;

  return (
    <Card
      title="Upload documents"
      subtitle="Drag & drop or browse; set a category per file (FR-IN-007)"
      actions={
        <div className={L.row}>
          <label className={L.muted} htmlFor="defcat">
            Default category
          </label>
          <select
            id="defcat"
            value={defaultCategory}
            onChange={(e) => setDefaultCategory(e.target.value as DocumentCategory)}
            style={{ padding: '6px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {humanCategory(c)}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <Dropzone onFiles={(files) => queue.addFiles(files, defaultCategory)} />

      {queue.items.length > 0 && (
        <>
          <div className={L.rowBetween} style={{ margin: '16px 0 4px' }}>
            <strong>{queue.items.length} file(s)</strong>
            <div className={L.row}>
              <Button small onClick={queue.clearFinished}>
                Clear finished
              </Button>
              <Button small variant="primary" disabled={pending === 0} onClick={queue.uploadAll}>
                Upload {pending > 0 ? `(${pending})` : ''}
              </Button>
            </div>
          </div>
          <div>
            {queue.items.map((item) => (
              <div key={item.id} className={s.queueItem}>
                <div>
                  <div className={s.fileName}>{item.file.name}</div>
                  <div className={s.fileMeta}>
                    {formatBytes(item.file.size)}
                    {item.parseStatus ? ` · parse: ${item.parseStatus}` : ''}
                    {item.message ? ` · ${item.message}` : ''}
                    {item.error ? ` · ${item.error}` : ''}
                  </div>
                </div>
                <div className={s.itemControls}>
                  <select
                    aria-label={`Category for ${item.file.name}`}
                    value={item.category}
                    disabled={item.status === 'uploading' || item.status === 'done'}
                    onChange={(e) => queue.setCategory(item.id, e.target.value as DocumentCategory)}
                    style={{ padding: '5px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                  >
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {humanCategory(c)}
                      </option>
                    ))}
                  </select>
                  <StatusBadge status={item.status} />
                  {item.status === 'uploading' && (
                    <Button small variant="ghost" onClick={() => queue.cancel(item.id)}>
                      Cancel
                    </Button>
                  )}
                  {(item.status === 'error' || item.status === 'cancelled') && (
                    <Button small onClick={() => queue.retry(item.id)}>
                      Retry
                    </Button>
                  )}
                  {item.status !== 'uploading' && (
                    <Button small variant="ghost" onClick={() => queue.removeItem(item.id)}>
                      Remove
                    </Button>
                  )}
                </div>
                {(item.status === 'uploading' || item.status === 'done') && (
                  <div className={s.progressCell}>
                    <Progress value={item.progress} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function DocumentList({ projectId }: { projectId: string }): JSX.Element {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.documents(projectId),
    queryFn: () => documentsApi.list(projectId),
    enabled: !!projectId,
  });
  const del = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.documents(projectId) }),
  });

  return (
    <Card title="Uploaded documents" subtitle="Per-file parse status (FR-IN-008)">
      <QueryState query={q} loadingLabel="Loading documents…">
        {(docs) =>
          docs.length === 0 ? (
            <EmptyState title="No documents uploaded">Upload sources above to begin.</EmptyState>
          ) : (
            <div>
              {docs.map((d) => (
                <div key={d.id} className={s.queueItem}>
                  <div>
                    <div className={s.fileName}>{d.filename}</div>
                    <div className={s.fileMeta}>
                      {humanCategory(d.category)} · {formatBytes(d.sizeBytes)} ·{' '}
                      {formatRelative(d.createdAt)}
                      {d.message ? ` · ${d.message}` : ''}
                    </div>
                  </div>
                  <div className={s.itemControls}>
                    <StatusBadge status={d.parseStatus} label={`parse: ${d.parseStatus}`} />
                    <Link to={`/documents/${d.id}/preview`}>
                      <Button small>Preview</Button>
                    </Link>
                    <Button
                      small
                      variant="ghost"
                      loading={del.isPending && del.variables === d.id}
                      onClick={() => del.mutate(d.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </QueryState>
    </Card>
  );
}

function ManualRequirement({ projectId }: { projectId: string }): JSX.Element {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [criteria, setCriteria] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      requirementsApi.create(projectId, {
        title: title.trim() || undefined,
        text: text.trim(),
        acceptanceCriteria: criteria
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
        source: 'manual',
      }),
    onSuccess: () => {
      setTitle('');
      setText('');
      setCriteria('');
      void qc.invalidateQueries({ queryKey: qk.requirements(projectId) });
      void qc.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });

  return (
    <Card title="Add requirement manually" subtitle="FR-IN-001 — feeds analysis and test generation">
      {mutation.isError && <ErrorBanner error={mutation.error} />}
      {mutation.isSuccess && <Banner kind="success">Requirement added.</Banner>}
      <TextInput
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="User can reset password"
      />
      <TextArea
        label="Requirement text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="As a user I want to reset my password so that…"
      />
      <TextArea
        label="Acceptance criteria (one per line)"
        value={criteria}
        onChange={(e) => setCriteria(e.target.value)}
        placeholder={'Given a valid email\nWhen I request a reset\nThen I receive a link'}
      />
      <Button
        variant="primary"
        loading={mutation.isPending}
        disabled={!text.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Add requirement
      </Button>
    </Card>
  );
}

function RequirementList({ projectId }: { projectId: string }): JSX.Element {
  const q = useQuery({
    queryKey: qk.requirements(projectId),
    queryFn: () => requirementsApi.list(projectId),
    enabled: !!projectId,
  });
  return (
    <Card title="Requirements">
      <QueryState query={q} loadingLabel="Loading requirements…">
        {(reqs) =>
          reqs.length === 0 ? (
            <p className={L.muted}>No requirements yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {reqs.map((r) => (
                <li key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className={L.rowBetween}>
                    <strong>{r.title || r.text.slice(0, 60)}</strong>
                    <span className={L.row}>
                      <span className={L.muted}>v{r.version}</span>
                      <StatusBadge status={r.status} />
                    </span>
                  </div>
                  <div className={L.muted} style={{ fontSize: 13 }}>
                    {r.text.slice(0, 160)}
                    {r.text.length > 160 ? '…' : ''}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Card>
  );
}

export function UploadPage(): JSX.Element {
  const projectId = useProjectId();
  return (
    <div className={L.stack}>
      <PageHeader title="Upload centre" subtitle="Documents and requirements (FR-IN-*)" />
      <UploadQueue projectId={projectId} />
      <DocumentList projectId={projectId} />
      <div className={L.split}>
        <ManualRequirement projectId={projectId} />
        <RequirementList projectId={projectId} />
      </div>
    </div>
  );
}
