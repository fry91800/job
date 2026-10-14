import type { AtsAdapter } from "./adapter";
import { ashby } from "./adapters/ashby";
import { greenhouse } from "./adapters/greenhouse";
import { lever, leverEu } from "./adapters/lever";
import { smartRecruiters } from "./adapters/smartrecruiters";

export const atsAdapters: AtsAdapter[] = [greenhouse, ashby, lever, leverEu, smartRecruiters];

export function findAdapter(ats: string): AtsAdapter | undefined {
  return atsAdapters.find((adapter) => adapter.ats === ats);
}
