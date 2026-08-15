import {
  Navigate,
  Route,
  createBrowserRouter,
  createRoutesFromElements,
} from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectNewPage } from './pages/ProjectNewPage';
import { ProjectOverviewPage } from './pages/ProjectOverviewPage';
import { ProjectSettingsPage } from './pages/ProjectSettingsPage';
import { UploadPage } from './pages/UploadPage';
import { DocumentPreviewPage } from './pages/DocumentPreviewPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { TestPlanPage } from './pages/TestPlanPage';
import { TestCasesPage } from './pages/TestCasesPage';
import { AutomationPage } from './pages/AutomationPage';
import { ValidationPage } from './pages/ValidationPage';
import { RegressionPage } from './pages/RegressionPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ExecutionLivePage } from './pages/ExecutionLivePage';
import { ExecutionReportPage } from './pages/ExecutionReportPage';
import { ProjectReportsPage } from './pages/ProjectReportsPage';
import { AuditPage } from './pages/AuditPage';
import { AccountsPage } from './pages/AccountsPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Route table (FR-FE-002). All app routes are SPA — no full reload. Built as a
 * data router (createBrowserRouter) so navigation-blocking works (useBlocker),
 * used to guard unsaved code edits on the Automation page (AC-003).
 */
export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        <Route path="/projects/new" element={<ProjectNewPage />} />
        <Route path="/projects/:id" element={<ProjectOverviewPage />} />
        <Route path="/projects/:id/settings" element={<ProjectSettingsPage />} />
        <Route path="/projects/:id/upload" element={<UploadPage />} />
        <Route path="/projects/:id/analysis" element={<AnalysisPage />} />
        <Route path="/projects/:id/test-plan" element={<TestPlanPage />} />
        <Route path="/projects/:id/test-cases" element={<TestCasesPage />} />
        <Route path="/projects/:id/automation" element={<AutomationPage />} />
        <Route path="/projects/:id/validation" element={<ValidationPage />} />
        <Route path="/projects/:id/regression" element={<RegressionPage />} />
        <Route path="/projects/:id/reports" element={<ProjectReportsPage />} />

        <Route path="/documents/:id/preview" element={<DocumentPreviewPage />} />

        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/accounts" element={<AccountsPage />} />

        <Route path="/executions/:id" element={<ExecutionLivePage />} />
        <Route path="/executions/:id/report" element={<ExecutionReportPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Route>,
  ),
);
