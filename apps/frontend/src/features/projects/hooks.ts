import { useParams } from 'react-router-dom';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { projectsApi } from '../../services/api/endpoints';
import { qk } from '../../services/api/queryKeys';
import type { ProjectWithSummary } from '../../services/api/types';

/** Read the `:id` route param for project-scoped pages. */
export function useProjectId(): string {
  const { id } = useParams<{ id: string }>();
  return id ?? '';
}

export function useProject(id: string): UseQueryResult<ProjectWithSummary> {
  return useQuery({
    queryKey: qk.project(id),
    queryFn: () => projectsApi.get(id),
    enabled: !!id,
  });
}
