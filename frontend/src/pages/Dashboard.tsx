import { fetchProjects } from "@lib/api";
import { useApi } from "@hooks/useApi";
import { ProjectTable } from "@components/ProjectTable";
import { LoadingState } from "@components/LoadingState";
import { ErrorState } from "@components/ErrorState";

export const DashboardPage = () => {
  const { data, loading, error, retry } = useApi(fetchProjects, []);
  if (loading) return <LoadingState message="Loading projects" />;
  if (error || !data) return <ErrorState message={error ?? "Unable to load projects."} onRetry={retry} />;
  return <ProjectTable projects={data} />;
};
