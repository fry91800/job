// Match percentage (FEATURE O4). The ONLY implementation: the web app uses it to display
// scores and the API to store the snapshot on generated resumes.

export type CatalogueLinks = { skillIds: number[]; occupationIds: number[] };

export type MatchConfig = {
  // Share of the skills when the offer has occupations; the rest for a shared occupation.
  skillWeight: number;
  // Skills matched for full skill coverage: an offer listing 25 skills is well covered by 8
  // of them. The skill part = matched / min(offer's skills, skillsForFull). null = all.
  skillsForFull: number | null;
  // Shown % = 100 × raw^displayExponent. 1 shows the raw share; below 1 lifts low and middle
  // scores the most, while 0 stays 0 and only a perfect match reaches 100 (others stop at
  // 99). Offers list many skills and resumes few, so raw scores read low. Shown for a raw
  // score of 20 / 40 / 60 / 80 %:
  //   1.0 → 20 / 40 / 60 / 80     0.7 → 32 / 53 / 70 / 86
  //   0.6 → 38 / 58 / 74 / 87     0.5 → 45 / 63 / 77 / 89     0.4 → 53 / 69 / 82 / 91
  // `npm run match:preview` shows the spread for a resume over the stored offers.
  displayExponent: number;
  // Badge colours, on the shown %: green from `strong`, normal from `medium`, else muted.
  strong: number;
  medium: number;
};

export const MATCH_CONFIG: MatchConfig = { skillWeight: 0.8, skillsForFull: 8, displayExponent: 0.6, strong: 75, medium: 50 };

export type MatchResult = {
  // Shown %; null = "Not enough data": the offer has no extracted skills.
  score: number | null;
  rawScore: number | null; // the plain weighted share, 0–100
  matchedSkillIds: number[];
  missingSkillIds: number[];
  sharesOccupation: boolean;
};

export function displayScore(raw: number, config: MatchConfig = MATCH_CONFIG): number {
  if (raw >= 1 - 1e-9) return 100; // weights summing to 1 can land a hair below it
  return Math.min(99, Math.round(100 * Math.max(0, raw) ** config.displayExponent));
}

export function computeMatch(offer: CatalogueLinks, resume: CatalogueLinks, config: MatchConfig = MATCH_CONFIG): MatchResult {
  const resumeSkills = new Set(resume.skillIds);
  const offerSkills = [...new Set(offer.skillIds)];
  const matchedSkillIds = offerSkills.filter((id) => resumeSkills.has(id));
  const missingSkillIds = offerSkills.filter((id) => !resumeSkills.has(id));
  const resumeOccupations = new Set(resume.occupationIds);
  const sharesOccupation = offer.occupationIds.some((id) => resumeOccupations.has(id));

  if (offerSkills.length === 0) return { score: null, rawScore: null, matchedSkillIds, missingSkillIds, sharesOccupation };

  const needed = config.skillsForFull === null ? offerSkills.length : Math.min(offerSkills.length, config.skillsForFull);
  const skillScore = Math.min(1, matchedSkillIds.length / needed);
  const raw =
    offer.occupationIds.length > 0 ? config.skillWeight * skillScore + (1 - config.skillWeight) * (sharesOccupation ? 1 : 0) : skillScore;
  return { score: displayScore(raw, config), rawScore: Math.round(100 * raw), matchedSkillIds, missingSkillIds, sharesOccupation };
}
