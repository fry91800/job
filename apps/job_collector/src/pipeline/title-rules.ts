import { normalizeTitle } from "./text";

// IT occupations from short job titles (ROME M18 codes). The catalogue's names are long
// ("développeur / développeuse informatique") and French, while titles are short and often
// English ("Staff Data Engineer", "Développeur Java / AWS Senior"): dictionary matching
// misses them. These rules complete it, for IT only (the slice measured first).
// Titles are compared normalized: no accents, lowercase, punctuation as spaces, "(H/F)"
// removed — "Ingénieur(e)" becomes "ingenieur e".

// A word ending: "dev" in "dev back" but not in "devis".
const W = "(?![a-z0-9])";
const ING = "ingenieur(?: e)?|ingenieure";

// Titles where "developer" / "développeur" isn't software: business developer, community
// developer, développeur foncier…
const NOT_SOFTWARE = new RegExp(
  `\\b(business|biz|community|commercial|commerciale|sales|audience|partnership|partenariats?|market|marketing|economique|foncier|fonciere|immobilier|territorial|culturel|photo|photographies|brand|talent|franchise|reseau commercial)\\b`,
);

type Rule = { code: string; pattern: RegExp; software?: true };

// Ordered from the most specific to the most general; every matching rule applies.
// Deliberately absent (not IT in most offers): "ingénieur de production" (factories),
// "infrastructure engineer" (civil works), "systems engineer" (aerospace), "QA" alone
// (pharma quality), "research scientist", "programmeur" (CNC machines), "dev" alone.
const RULES: Rule[] = [
  { code: "M1831", software: true, pattern: new RegExp(`\\b(game|gameplay|jeux? video|unity|unreal)\\b.*\\b(developer|developpeu|programmer|programmeu|engineer|${ING})`) },
  { code: "M1811", pattern: new RegExp(`\\b((data|big data) (engineer|${ING})|(${ING}) (big )?(data|donnees)|dataops)${W}`) },
  { code: "M1889", pattern: new RegExp(`\\b(data scientist|machine learning|ml engineer|mlops|ai engineer|llm|deep learning|computer vision|nlp|(${ING}) (ia|intelligence artificielle))${W}`) },
  { code: "M1851", pattern: new RegExp(`\\b(data analyst|bi analyst|analyste (de )?donnees|analyste (bi|decisionnel)|business intelligence|power bi|analytics engineer)${W}`) },
  { code: "M1868", pattern: new RegExp(`\\b(dba|database (administrator|engineer)|administrat(eur|rice) (de )?bases? de donnees|architecte (de )?bases? de donnees)${W}`) },
  { code: "M1827", pattern: new RegExp(`\\b(devops|devsecops|sre|site reliability|platform engineer)${W}`) },
  { code: "M1860", software: true, pattern: new RegExp(`\\b(cloud (engineer|architect|ops|consultant)|architecte cloud|(${ING}) cloud|aws|azure|gcp)${W}`) },
  { code: "M1856", pattern: /\b(cyber ?securite|cyber ?security|security (engineer|analyst|architect)|securite (informatique|des systemes d information|si|operationnelle)|pentest(eur|euse|er)?|soc analyst|analyste soc|rssi|ciso|threat intelligence|vulnerability)/ },
  { code: "M1884", pattern: new RegExp(`\\b(administrat(eur|rice) (systemes?|reseaux?|sys)|sysadmin|system administrator|network (engineer|administrator)|(${ING}) (systemes? (et|&) reseaux?|reseaux?( (et|&) (systemes?|securite|telecoms?))?)|technicien(ne)? (reseaux?|systemes? (et|&) reseaux?))${W}`) },
  { code: "M1815", software: true, pattern: new RegExp(`\\b(qa (automation|engineer|tester|lead|analyst)|software qa|test automation|automation (tester|engineer)|sdet|testeu(r|se)( (logiciel|fonctionnel(le)?|qa|automatisation))?|(${ING}) (test|tests|qualification|validation) (logiciel|software|fonctionnel(le)?|automatise)|software (tester|test engineer))${W}`) },
  { code: "M1864", pattern: /\bproduct owner\b/ },
  { code: "M1834", pattern: /\bwebmaster\b/ },
  { code: "M1881", pattern: /\b(chef(fe)? de projets? (amoa|moa)|amoa|moa si)\b/ },
  { code: "M1826", pattern: /\b(data ?cent(er|re)|datacenter)\b/ },
  { code: "M1804", pattern: new RegExp(`\\b((${ING}|administrat(eur|rice)|technicien(ne)?) (des )?telecoms?|coeur de reseau|telecom engineer)${W}`) },
  { code: "M1814", pattern: /\b(scrum master|agile coach|coach agile)\b/ },
  { code: "M1892", pattern: new RegExp(`\\b(embedded (software|engineer|developer|systems?)|logiciels? embarques?|systemes? embarques?|(${ING}|developpeu(r|se)) (en )?(logiciel |informatique )?embarquee?|firmware)${W}`) },
  { code: "M1803", pattern: /\b(cto|chief technology officer|chief information officer|dsi|directeur (des )?systemes d information|head of (engineering|it|technology|infrastructure|data)|vp (of )?engineering|engineering manager|it director)\b/ },
  { code: "M1874", pattern: new RegExp(`\\b(support (informatique|it|applicatif|utilisateurs?)|it support|helpdesk|help desk|service desk|technicien(ne)? (informatique|support|helpdesk|it|de proximite)|desktop support)${W}`) },
  { code: "M1806", pattern: new RegExp(`\\b(consultant(e)? (fonctionnel(le)?|sap|salesforce|erp|crm|servicenow|workday|oracle|microsoft dynamics|dynamics 365|it|si|amoa|moa)|functional consultant|sap (consultant|fico|mm|sd|abap)|business analyst)${W}`) },
  { code: "M1853", pattern: new RegExp(`\\b(chef(fe)? de projets? (it|informatique|si|technique|digital|web|applicatif|data|erp|sap|mainframe)|chef(fe)? de projets? .*\\b(si|systemes? d information)$|it project manager|technical project manager|(it|technical) program manager)${W}`) },
  { code: "M1836", pattern: new RegExp(`\\b(architecte (logiciel|solutions?|technique|si|applicati(f|ve)|it|data|entreprise|d entreprise)|(software|solutions?|enterprise|technical|data) architect)${W}`) },
  // Developers last: the most frequent and the widest.
  {
    code: "M1805",
    software: true,
    pattern: new RegExp(
      `\\b(developpeu(r|se)|developer|software (engineer|developer)|full ?stack|front ?end|back ?end|tech ?lead|lead dev|dev (back|front|full|java|python|web|mobile)|(mobile|ios|android|java|python|golang|rust|php|ruby|scala|kotlin|net) (engineer|developer)|staff engineer|integrat(eur|rice) web|mainframe|cobol|(${ING}) (d )?etudes? (et )?developpement|(${ING}) (en )?(logiciel|software|developpement (logiciel|informatique|software|web|mobile|java|python|c\\+\\+|c#|net|full ?stack|front ?end|back ?end|applicati\\w*)|developpement$))${W}`,
    ),
  },
];

export function itOccupationCodes(title: string): string[] {
  const text = normalizeTitle(title);
  const software = !NOT_SOFTWARE.test(text);
  return [...new Set(RULES.filter((rule) => (software || !rule.software) && rule.pattern.test(text)).map((rule) => rule.code))];
}
