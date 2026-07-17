import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/PageHeader';
import { QueryState } from '../components/QueryState';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Banner, ErrorBanner } from '../components/ui/Banner';
import { useProjectId } from '../features/projects/hooks';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { analysisApi, requirementsApi } from '../services/api/endpoints';
import { qk } from '../services/api/queryKeys';
import type { Analysis, RequirementAnalysisOutput } from '../services/api/types';
import { toDisplayString } from '../lib/sanitize';
import { formatRelative } from '../lib/format';
import L from '../styles/layout.module.css';

function asList(...values: unknown[]): string[] {
  for (const v of values) {
    if (Array.isArray(v)) return v.map(toDisplayString).filter(Boolean);
  }
  return [];
}

function riskOf(a: Analysis): number {
  const o = a.output as RequirementAnalysisOutput;
  return a.riskScore ?? o.riskScore ?? o.risk_score ?? 0;
}

function Bullets({ title, items }: { title: string; items: string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className={L.muted} style={{ fontWeight: 600, marginBottom: 4 }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: Analysis }): JSX.Element {
  const o = analysis.output as RequirementAnalysisOutput;
  const risk = riskOf(analysis);
  const riskTone = risk >= 7 ? 'danger' : risk >= 4 ? 'warn' : 'ok';
  return (
    <Card
      title={o.summary ? toDisplayString(o.summary).slice(0, 80) : `Analysis ${analysis.id.slice(0, 8)}`}
      subtitle={`${analysis.model || 'model'} · ${formatRelative(analysis.createdAt)}`}
      actions={<StatusBadge status={riskTone} label={`risk ${risk}/10`} />}
    >
      <Bullets title="Actors" items={asList(o.actors)} />
      <Bullets title="Assumptions" items={asList(o.assumptions)} />
      <Bullets title="Gaps" items={asList(o.gaps)} />
      <Bullets
        title="Clarification questions"
        items={asList(o.clarificationQuestions, o.clarification_questions)}
      />
      {o.riskRationale != null && (
        <div style={{ marginTop: 10 }}>
          <div className={L.muted} style={{ fontWeight: 600 }}>
            Risk rationale
          </div>
          <div>{toDisplayString(o.riskRationale)}</div>
        </div>
      )}
    </Card>
  );
}

export function AnalysisPage(): JSX.Element {
  const projectId = useProjectId();
  const qc = useQueryClient();
  useProjectEvents(projectId);

  const requirementsQuery = useQuery({
    queryKey: qk.requirements(projectId),
    queryFn: () => requirementsApi.list(projectId),
    enabled: !!projectId,
  });
  const analysesQuery = useQuery({
    queryKey: qk.analyses(projectId),
    queryFn: () => analysisApi.list(projectId),
    enabled: !!projectId,
  });

  const runAnalysis = useMutation({
    mutationFn: () => {
      const requirementIds = (requirementsQuery.data ?? []).map((r) => r.id);
      return analysisApi.createJob(projectId, { requirementIds });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.jobs(projectId) });
    },
  });

  const reqCount = requirementsQuery.data?.length ?? 0;

  return (
    <div className={L.stack}>
      <PageHeader
        title="Requirement analysis"
        subtitle="Actors, assumptions, gaps and risk (FR-RA-*)"
        actions={
          <Button
            variant="primary"
            loading={runAnalysis.isPending}
            disabled={reqCount === 0 || runAnalysis.isPending}
            onClick={() => runAnalysis.mutate()}
          >
            Analyse {reqCount} requirement{reqCount === 1 ? '' : 's'}
          </Button>
        }
      />

      {runAnalysis.isError && <ErrorBanner error={runAnalysis.error} />}
      {runAnalysis.isSuccess && (
        <Banner kind="info">
          Analysis job queued ({runAnalysis.data.status}). Results appear below as each requirement
          completes.
        </Banner>
      )}
      {reqCount === 0 && requirementsQuery.isSuccess && (
        <Banner kind="warn">Add requirements or upload documents first to run analysis.</Banner>
      )}

      <QueryState query={analysesQuery} loadingLabel="Loading analyses…">
        {(analyses) =>
          analyses.length === 0 ? (
            <EmptyState title="No analysis yet">
              Run analysis to extract actors, assumptions, gaps and a risk score.
            </EmptyState>
          ) : (
            <div className={L.grid2}>
              {analyses.map((a) => (
                <AnalysisCard key={a.id} analysis={a} />
              ))}
            </div>
          )
        }
      </QueryState>
    </div>
  );
}
