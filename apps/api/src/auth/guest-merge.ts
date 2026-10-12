import type { Prisma } from "@prisma/client";
import { SAVED_OFFER_NOTES_MAX_LENGTH } from "@job/shared";

// Logging in while a guest moves the guest's data to the account, then deletes the guest
// and its sessions (FEATURE A2). Runs inside the caller's transaction.
export async function mergeGuestInto(tx: Prisma.TransactionClient, guestId: string, accountId: string): Promise<void> {
  const moveTo = { userId: accountId };
  await tx.resume.updateMany({ where: { userId: guestId }, data: moveTo });
  await tx.userPhoto.updateMany({ where: { userId: guestId }, data: moveTo });
  await tx.generatedResume.updateMany({ where: { userId: guestId }, data: moveTo });
  await tx.offer.updateMany({ where: { createdByUserId: guestId }, data: { createdByUserId: accountId } });

  // Saved offers: when both saved the same offer, the account's row wins and the
  // guest's notes are appended to it. The guest's duplicates go with the guest row.
  const guestSaved = await tx.savedOffer.findMany({ where: { userId: guestId } });
  const accountSaved = new Map(
    (await tx.savedOffer.findMany({ where: { userId: accountId, offerId: { in: guestSaved.map((saved) => saved.offerId) } } }))
      .map((saved) => [saved.offerId, saved]),
  );
  for (const saved of guestSaved) {
    const existing = accountSaved.get(saved.offerId);
    if (!existing) {
      await tx.savedOffer.update({ where: { id: saved.id }, data: moveTo });
    } else if (saved.notes) {
      const notes = [existing.notes, saved.notes].filter(Boolean).join("\n\n").slice(0, SAVED_OFFER_NOTES_MAX_LENGTH);
      await tx.savedOffer.update({ where: { id: existing.id }, data: { notes } });
    }
  }

  // Settings: the account's win. The guest's selected resume is kept only if the
  // account has none (selected_resume_id is unique, so clear the guest's first).
  const [guest, account] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: guestId }, select: { selectedResumeId: true } }),
    tx.user.findUniqueOrThrow({ where: { id: accountId }, select: { selectedResumeId: true } }),
  ]);
  if (guest.selectedResumeId && !account.selectedResumeId) {
    await tx.user.update({ where: { id: guestId }, data: { selectedResumeId: null } });
    await tx.user.update({ where: { id: accountId }, data: { selectedResumeId: guest.selectedResumeId } });
  }

  await tx.user.delete({ where: { id: guestId } });
}
