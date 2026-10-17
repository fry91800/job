import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobAlert, JobAlertFrequency, JobAlertListResponse } from "@job/shared";
import { api, ApiError } from "../api/client";
import { useMe } from "../api/queries";
import { track } from "../lib/analytics";

// Job alerts (GROWTH.md phase 2).

const alertKeys = { list: ["alerts"] as const };

// Accounts only: guests and visitors have none.
export function useAlerts() {
  const registered = useMe().data?.user?.isGuest === false;
  return useQuery({
    queryKey: alertKeys.list,
    enabled: registered,
    queryFn: async ({ signal }) => {
      try {
        return (await api<JobAlertListResponse>("GET", "/api/alerts", { signal })).results;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return [];
        throw error;
      }
    },
  });
}

export function useCreateAlert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { query: string; label: string }) => api<JobAlert>("POST", "/api/alerts", { body: input }),
    onSuccess: () => {
      track("alert_create");
      void client.invalidateQueries({ queryKey: alertKeys.list });
    },
  });
}

export function useUpdateAlert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...change }: { id: string; frequency?: JobAlertFrequency; paused?: boolean }) => api<JobAlert>("PATCH", `/api/alerts/${id}`, { body: change }),
    onSuccess: (alert) => client.setQueryData<JobAlert[]>(alertKeys.list, (list) => list?.map((item) => (item.id === alert.id ? alert : item))),
  });
}

export function useDeleteAlert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/alerts/${id}`),
    onSuccess: (_result, id) => client.setQueryData<JobAlert[]>(alertKeys.list, (list) => list?.filter((item) => item.id !== id)),
  });
}
