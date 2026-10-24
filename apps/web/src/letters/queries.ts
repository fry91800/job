import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CoverLetterDetail, CoverLetterListResponse } from "@job/shared";
import { api } from "../api/client";
import { keys } from "../api/queries";
import { track } from "../lib/analytics";

// Cover letters (FEATURE M5).

export const letterKeys = { list: (offerId?: string) => (offerId ? (["letters", { offerId }] as const) : (["letters"] as const)), one: (id: string) => ["letter", id] as const };

export function useLetters(offerId?: string) {
  return useQuery({
    queryKey: letterKeys.list(offerId),
    queryFn: ({ signal }) => api<CoverLetterListResponse>("GET", `/api/cover-letters${offerId ? `?offerId=${offerId}` : ""}`, { signal }),
  });
}

export function useLetter(id: string) {
  return useQuery({ queryKey: letterKeys.one(id), queryFn: ({ signal }) => api<CoverLetterDetail>("GET", `/api/cover-letters/${id}`, { signal }) });
}

// Writing a letter saves the offer, as generating a resume does.
export function useWriteLetter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { offerId: string; resumeId?: string }) => api<CoverLetterDetail>("POST", "/api/cover-letters", { body: input }),
    onSuccess: (detail) => {
      track("letter_write");
      client.setQueryData(letterKeys.one(detail.id), detail);
      void client.invalidateQueries({ queryKey: ["letters"] });
      void client.invalidateQueries({ queryKey: ["saved-offers"] });
      void client.invalidateQueries({ queryKey: ["search"] });
      void client.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useUpdateLetter(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { subject?: string; body?: string }) => api<CoverLetterDetail>("PATCH", `/api/cover-letters/${id}`, { body: input }),
    onSuccess: (detail) => {
      client.setQueryData(letterKeys.one(id), detail);
      void client.invalidateQueries({ queryKey: ["letters"] });
    },
  });
}

export function useDeleteLetter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/cover-letters/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["letters"] }),
  });
}
