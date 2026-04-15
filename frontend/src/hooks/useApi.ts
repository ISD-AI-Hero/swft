import { useCallback, useEffect, useState } from "react";
import type { ApiState } from "@lib/types";

// Small wrapper around async data loading so callers get consistent loading/error flags.
// Returns a `retry` callback so error states can offer a manual refetch without a full remount.
export const useApi = <T,>(loader: () => Promise<T>, deps: unknown[] = []): ApiState<T> & { retry: () => void } => {
  const [state, setState] = useState<ApiState<T>>({ data: null, loading: true, error: null });
  const [retryKey, setRetryKey] = useState(0);
  // Memoise the fetch routine so we only refire when the caller's dependency list changes.
  const execute = useCallback(async () => {
    try {
      setState({ data: null, loading: true, error: null });
      const data = await loader();
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({ data: null, loading: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  // Kick the fetch whenever the dependencies indicate the underlying request should change.
  // retryKey bumps trigger a refetch independently of dep changes.
  useEffect(() => { void execute(); }, [execute, retryKey]);
  const retry = useCallback(() => setRetryKey((k) => k + 1), []);
  return { ...state, retry };
};
