// Match percentage (FEATURE O4). The ONLY implementation: the web app uses it to display
// scores and the API to store the snapshot on generated resumes.

export type CatalogueLinks = { skillIds: number[]; occupationIds: number[] };

export type MatchResult = {
  // null = "Not enough data": the offer has no extracted skills.
  score: number | null;
  matchedSkillIds: number[];
  missingSkillIds: number[];
  sharesOccupation: boolean;
};

export function computeMatch(offer: CatalogueLinks, resume: CatalogueLinks): MatchResult {
  const resumeSkills = new Set(resume.skillIds);
  const offerSkills = [...new Set(offer.skillIds)];
  const matchedSkillIds = offerSkills.filter((id) => resumeSkills.has(id));
  const missingSkillIds = offerSkills.filter((id) => !resumeSkills.has(id));
  const resumeOccupations = new Set(resume.occupationIds);
  const sharesOccupation = offer.occupationIds.some((id) => resumeOccupations.has(id));

  if (offerSkills.length === 0) return { score: null, matchedSkillIds, missingSkillIds, sharesOccupation };

  const skillScore = matchedSkillIds.length / offerSkills.length;
  const score =
    offer.occupationIds.length > 0
      ? Math.round(100 * (0.8 * skillScore + 0.2 * (sharesOccupation ? 1 : 0)))
      : Math.round(100 * skillScore);
  return { score, matchedSkillIds, missingSkillIds, sharesOccupation };
}
