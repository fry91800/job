import type { AtsAdapter } from "./adapter";
import { ashby } from "./adapters/ashby";
import { greenhouse } from "./adapters/greenhouse";
import { lever, leverEu } from "./adapters/lever";
import { recruitee } from "./adapters/recruitee";
import { aldi } from "./adapters/aldi";
import { amazon } from "./adapters/amazon";
import { gestmax } from "./adapters/gestmax";
import { avature } from "./adapters/avature";
import { cornerstone } from "./adapters/cornerstone";
import { jibe } from "./adapters/jibe";
import { oracle } from "./adapters/oracle";
import { phenom } from "./adapters/phenom";
import { smartRecruiters } from "./adapters/smartrecruiters";
import { successFactors } from "./adapters/successfactors";
import { workable } from "./adapters/workable";
import { careerSite } from "../crawler/career-site";
import { servicePublic } from "./adapters/service-public";
import { talentsoft } from "./adapters/talentsoft";
import { workday } from "./adapters/workday";

// Career sites (a crawler) use the same registry, checks and full sync as the ATS boards.
export const atsAdapters: AtsAdapter[] = [greenhouse, ashby, lever, leverEu, smartRecruiters, workable, recruitee, careerSite, talentsoft, servicePublic, workday, successFactors, phenom, jibe, aldi, avature, oracle, cornerstone, amazon, gestmax];

export function findAdapter(ats: string): AtsAdapter | undefined {
  return atsAdapters.find((adapter) => adapter.ats === ats);
}
