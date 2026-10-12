import type { MeResponse, UiLanguage } from "@job/shared";
import { prisma } from "../lib/prisma";

export async function getMe(userId: string | undefined): Promise<MeResponse> {
  if (!userId) return { user: null };

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      uiLanguage: true,
      searchLocationId: true,
      templateId: true,
      selectedResume: {
        select: { id: true, skills: { select: { skillId: true } }, occupations: { select: { occupationId: true } } },
      },
    },
  });

  return {
    user: {
      id: user.id,
      isGuest: user.email === null,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      uiLanguage: user.uiLanguage as UiLanguage,
      searchLocationId: user.searchLocationId,
      templateId: user.templateId,
      selectedResume: user.selectedResume && {
        id: user.selectedResume.id,
        skillIds: user.selectedResume.skills.map((link) => link.skillId),
        occupationIds: user.selectedResume.occupations.map((link) => link.occupationId),
      },
    },
  };
}
