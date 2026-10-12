import { z } from "zod";

// Photos (FEATURE R6).

export const photoUploadQuerySchema = z.object({ name: z.string().trim().min(1).max(100).optional() });
export const photoRenameSchema = z.strictObject({ name: z.string().trim().min(1).max(100) });

export type Photo = {
  id: string;
  name: string;
  isSelected: boolean;
  sizeBytes: number;
  createdAt: string;
};

export type PhotoListResponse = { results: Photo[] };
