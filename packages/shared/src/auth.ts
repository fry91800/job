import { z } from "zod";

// Account rules (FEATURE A1). The web app uses the same schemas for its forms.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const UI_LANGUAGES = ["fr", "en"] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  uiLanguage: z.enum(UI_LANGUAGES).optional(),
});

// No length rule on login: an old password that no longer fits the rules must still work.
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

// GET /api/auth/me
export type MeResponse = {
  user: {
    id: string;
    isGuest: boolean;
    email: string | null;
    emailVerified: boolean;
    uiLanguage: UiLanguage;
    searchLocationId: number | null;
    templateId: number;
    // The selected resume's catalogue links, for the match % (FEATURE O4).
    selectedResume: { id: string; skillIds: number[]; occupationIds: number[] } | null;
  } | null;
};
