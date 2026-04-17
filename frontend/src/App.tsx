import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@components/AppShell";
import { AuthGuard } from "@components/AuthGuard";
import { DashboardPage } from "@pages/Dashboard";
import { LoadingState } from "@components/LoadingState";
import { SWFT_WORKSPACE_ENABLED } from "@lib/features";

const ProjectPage = lazy(() =>
  import("@pages/ProjectView").then((m) => ({ default: m.ProjectPage }))
);
const RunPage = lazy(() =>
  import("@pages/RunView").then((m) => ({ default: m.RunPage }))
);
const SwftHomePage = lazy(() =>
  import("@pages/SwftHome").then((m) => ({ default: m.SwftHomePage }))
);
const SwftWorkspacePage = lazy(() =>
  import("@pages/SwftWorkspace").then((m) => ({ default: m.SwftWorkspacePage }))
);

export const App = () => (
  <BrowserRouter future={{ v7_relativeSplatPath: true }}>
    <AuthGuard>
      <AppShell>
        <Suspense fallback={<LoadingState message="Loading" />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects/:projectId" element={<ProjectPage />} />
            <Route path="/projects/:projectId/runs/:runId" element={<RunPage />} />
            {SWFT_WORKSPACE_ENABLED ? (
              <>
                <Route path="/swft" element={<SwftHomePage />} />
                <Route path="/swft/:projectId" element={<SwftWorkspacePage />} />
              </>
            ) : (
              <>
                <Route path="/swft" element={<Navigate to="/" replace />} />
                <Route path="/swft/:projectId" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </Suspense>
      </AppShell>
    </AuthGuard>
  </BrowserRouter>
);
