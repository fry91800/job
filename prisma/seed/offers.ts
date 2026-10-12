import type { ContractType, RemoteType, SalaryPeriod } from "@prisma/client";
import { skills } from "./catalogue";
import { offerCityWeights, locations } from "./locations";
import { hoursAgo, type Random } from "./helpers";

export type SeedOffer = {
  key: string;
  title: string;
  companyName: string | null;
  description: string;
  language: "fr" | "en";
  url: string | null;
  locationKey: string | null;
  remoteType: RemoteType | null;
  contractType: ContractType | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  isPublic: boolean;
  source: string;
  externalId: string | null;
  createdByUserKey: string | null;
  publishedAt: Date | null;
  closedAt: Date | null;
  skillKeys: string[];
  occupationKeys: string[];
};

type Profile = {
  key: string;
  weight: number;
  occupations: string[];
  titles: { fr: string[]; en: string[] };
  required: string[];
  optional: string[];
  salary: [number, number]; // yearly EUR for a permanent contract
  missions: [fr: string, en: string][];
};

const profiles: Profile[] = [
  {
    key: "fullstack-js", weight: 12, occupations: ["fullstack-developer"],
    titles: { fr: ["Développeur Full Stack JavaScript", "Développeur Fullstack Node.js / React", "Développeuse Full Stack TypeScript"], en: ["Full Stack Developer (Node.js / React)", "Fullstack TypeScript Engineer"] },
    required: ["typescript", "nodejs", "react"], optional: ["express", "postgresql", "docker", "git", "rest-api", "graphql", "aws", "ci-cd", "mongodb", "scrum"],
    salary: [38000, 60000],
    missions: [
      ["Concevoir et développer de nouvelles fonctionnalités de bout en bout", "Design and build new features end to end"],
      ["Participer aux choix d'architecture et aux revues de code", "Take part in architecture decisions and code reviews"],
      ["Améliorer la qualité et la performance de l'application", "Improve the quality and performance of the application"],
    ],
  },
  {
    key: "backend-node", weight: 8, occupations: ["backend-developer"],
    titles: { fr: ["Développeur Back-end Node.js", "Développeur Backend TypeScript"], en: ["Backend Developer (Node.js)", "Backend Engineer – TypeScript"] },
    required: ["nodejs", "typescript", "postgresql"], optional: ["express", "nestjs", "docker", "redis", "rest-api", "graphql", "kubernetes", "aws", "git"],
    salary: [40000, 62000],
    missions: [
      ["Développer et maintenir nos API", "Build and maintain our APIs"],
      ["Modéliser les données et optimiser les requêtes", "Model data and optimise queries"],
      ["Mettre en place les tests et la supervision", "Set up tests and monitoring"],
    ],
  },
  {
    key: "frontend-react", weight: 7, occupations: ["frontend-developer"],
    titles: { fr: ["Développeur Front-end React", "Intégrateur / Développeur Front React"], en: ["Frontend Developer (React)", "React Engineer"] },
    required: ["react", "javascript", "css"], optional: ["typescript", "html", "figma", "cypress", "git", "scrum", "graphql"],
    salary: [35000, 55000],
    missions: [
      ["Développer des interfaces réactives et accessibles", "Build responsive and accessible interfaces"],
      ["Travailler avec les designers sur les maquettes", "Work with designers on mock-ups"],
      ["Maintenir la bibliothèque de composants", "Maintain the component library"],
    ],
  },
  {
    key: "frontend-angular-vue", weight: 4, occupations: ["frontend-developer"],
    titles: { fr: ["Développeur Front-end Angular", "Développeur Vue.js"], en: ["Angular Developer", "Vue.js Developer"] },
    required: ["javascript", "html", "css"], optional: ["angular", "vue", "typescript", "git", "automated-testing"],
    salary: [34000, 52000],
    missions: [
      ["Développer les écrans de notre application métier", "Build the screens of our business application"],
      ["Intégrer les API fournies par l'équipe back-end", "Integrate the APIs provided by the back-end team"],
      ["Écrire des tests unitaires", "Write unit tests"],
    ],
  },
  {
    key: "java", weight: 7, occupations: ["backend-developer", "software-developer"],
    titles: { fr: ["Développeur Java Spring Boot", "Ingénieur Développement Java"], en: ["Java Developer (Spring Boot)"] },
    required: ["java", "spring", "sql"], optional: ["postgresql", "docker", "kubernetes", "ci-cd", "git", "rest-api", "scrum"],
    salary: [40000, 60000],
    missions: [
      ["Développer des microservices Java", "Develop Java microservices"],
      ["Participer à la migration vers le cloud", "Take part in the cloud migration"],
      ["Assurer la maintenance évolutive et corrective", "Handle maintenance and bug fixes"],
    ],
  },
  {
    key: "dotnet", weight: 5, occupations: ["software-developer"],
    titles: { fr: ["Développeur .NET C#", "Développeur C# / ASP.NET"], en: [".NET Developer"] },
    required: ["csharp", "dotnet", "sql"], optional: ["azure", "git", "rest-api", "angular", "scrum"],
    salary: [38000, 58000],
    missions: [
      ["Faire évoluer nos applications .NET", "Evolve our .NET applications"],
      ["Rédiger les spécifications techniques", "Write technical specifications"],
      ["Accompagner les utilisateurs lors des mises en production", "Support users during releases"],
    ],
  },
  {
    key: "php", weight: 5, occupations: ["backend-developer"],
    titles: { fr: ["Développeur PHP Symfony", "Développeur Web PHP"], en: ["PHP Symfony Developer"] },
    required: ["php", "symfony", "mysql"], optional: ["docker", "git", "javascript", "rest-api", "linux"],
    salary: [33000, 50000],
    missions: [
      ["Développer notre plateforme e-commerce", "Develop our e-commerce platform"],
      ["Intégrer des services tiers (paiement, livraison)", "Integrate third-party services (payment, delivery)"],
      ["Améliorer la sécurité et les performances", "Improve security and performance"],
    ],
  },
  {
    key: "python-backend", weight: 5, occupations: ["backend-developer"],
    titles: { fr: ["Développeur Python Django", "Développeur Back-end Python"], en: ["Python Developer (Django)"] },
    required: ["python", "django", "postgresql"], optional: ["docker", "rest-api", "git", "aws", "redis", "linux"],
    salary: [38000, 58000],
    missions: [
      ["Développer les API de notre produit SaaS", "Build the APIs of our SaaS product"],
      ["Automatiser les traitements de données", "Automate data processing"],
      ["Participer aux astreintes de l'équipe", "Take part in the team's on-call rotation"],
    ],
  },
  {
    key: "devops", weight: 6, occupations: ["devops-engineer"],
    titles: { fr: ["Ingénieur DevOps", "DevOps / SRE"], en: ["DevOps Engineer", "Site Reliability Engineer"] },
    required: ["docker", "kubernetes", "ci-cd", "linux"], optional: ["terraform", "aws", "gcp", "azure", "python", "go", "git"],
    salary: [45000, 70000],
    missions: [
      ["Automatiser les déploiements et l'infrastructure", "Automate deployments and infrastructure"],
      ["Améliorer l'observabilité de la plateforme", "Improve platform observability"],
      ["Accompagner les équipes de développement", "Support the development teams"],
    ],
  },
  {
    key: "sysadmin", weight: 3, occupations: ["sysadmin"],
    titles: { fr: ["Administrateur Systèmes et Réseaux", "Technicien Systèmes Linux"], en: ["Linux System Administrator"] },
    required: ["linux", "cybersecurity"], optional: ["docker", "azure", "git", "python"],
    salary: [32000, 48000],
    missions: [
      ["Administrer le parc de serveurs", "Administer the server fleet"],
      ["Gérer les sauvegardes et la sécurité", "Manage backups and security"],
      ["Assurer le support de niveau 2", "Provide level 2 support"],
    ],
  },
  {
    key: "data-scientist", weight: 4, occupations: ["data-scientist"],
    titles: { fr: ["Data Scientist", "Data Scientist Senior"], en: ["Data Scientist", "Machine Learning Engineer"] },
    required: ["python", "machine-learning", "pandas"], optional: ["sql", "spark", "aws", "docker", "git"],
    salary: [42000, 68000],
    missions: [
      ["Construire des modèles de prévision", "Build forecasting models"],
      ["Mettre les modèles en production", "Deploy models to production"],
      ["Présenter les résultats aux équipes métier", "Present results to business teams"],
    ],
  },
  {
    key: "data-analyst", weight: 4, occupations: ["data-analyst"],
    titles: { fr: ["Data Analyst", "Analyste de données Power BI"], en: ["Data Analyst", "BI Analyst"] },
    required: ["sql", "power-bi", "excel"], optional: ["python", "pandas", "communication", "english"],
    salary: [34000, 50000],
    missions: [
      ["Construire et maintenir les tableaux de bord", "Build and maintain dashboards"],
      ["Analyser les indicateurs de performance", "Analyse performance indicators"],
      ["Former les utilisateurs aux outils de reporting", "Train users on reporting tools"],
    ],
  },
  {
    key: "data-engineer", weight: 4, occupations: ["data-engineer"],
    titles: { fr: ["Data Engineer", "Ingénieur Data"], en: ["Data Engineer"] },
    required: ["python", "sql", "spark"], optional: ["aws", "gcp", "docker", "kubernetes", "postgresql", "terraform"],
    salary: [45000, 65000],
    missions: [
      ["Concevoir les pipelines de données", "Design data pipelines"],
      ["Garantir la qualité des données", "Ensure data quality"],
      ["Optimiser les coûts de la plateforme data", "Optimise data platform costs"],
    ],
  },
  {
    key: "mobile", weight: 3, occupations: ["mobile-developer"],
    titles: { fr: ["Développeur Mobile Flutter", "Développeur iOS / Android"], en: ["Mobile Developer (Flutter)"] },
    required: ["flutter"], optional: ["kotlin", "swift", "git", "rest-api", "ci-cd"],
    salary: [38000, 56000],
    missions: [
      ["Développer notre application mobile", "Develop our mobile app"],
      ["Publier sur l'App Store et le Play Store", "Publish to the App Store and Play Store"],
      ["Suivre les retours utilisateurs", "Follow up on user feedback"],
    ],
  },
  {
    key: "qa", weight: 3, occupations: ["qa-engineer"],
    titles: { fr: ["Ingénieur QA / Testeur", "QA Automaticien"], en: ["QA Automation Engineer"] },
    required: ["automated-testing", "cypress"], optional: ["javascript", "ci-cd", "jira", "scrum", "sql"],
    salary: [35000, 50000],
    missions: [
      ["Rédiger et automatiser les plans de test", "Write and automate test plans"],
      ["Suivre les anomalies", "Track defects"],
      ["Valider les livraisons", "Validate releases"],
    ],
  },
  {
    key: "product-manager", weight: 3, occupations: ["product-manager"],
    titles: { fr: ["Product Manager", "Product Owner"], en: ["Product Manager"] },
    required: ["scrum", "jira"], optional: ["ux-design", "sql", "communication", "english", "project-management"],
    salary: [45000, 65000],
    missions: [
      ["Définir la feuille de route produit", "Define the product roadmap"],
      ["Rédiger les user stories", "Write user stories"],
      ["Mesurer l'impact des fonctionnalités", "Measure the impact of features"],
    ],
  },
  {
    key: "ux-designer", weight: 3, occupations: ["ux-designer"],
    titles: { fr: ["Designer UX/UI", "UI Designer"], en: ["Product Designer (UX/UI)"] },
    required: ["figma", "ux-design"], optional: ["html", "css", "communication", "scrum"],
    salary: [35000, 52000],
    missions: [
      ["Mener des entretiens utilisateurs", "Run user interviews"],
      ["Concevoir les maquettes et prototypes", "Design mock-ups and prototypes"],
      ["Faire vivre le design system", "Maintain the design system"],
    ],
  },
  {
    key: "project-manager", weight: 3, occupations: ["project-manager"],
    titles: { fr: ["Chef de Projet Informatique", "Chef de Projet Digital"], en: ["IT Project Manager"] },
    required: ["project-management"], optional: ["scrum", "jira", "communication", "english", "sap"],
    salary: [42000, 60000],
    missions: [
      ["Piloter les projets de bout en bout", "Run projects end to end"],
      ["Coordonner les équipes internes et les prestataires", "Coordinate internal teams and suppliers"],
      ["Suivre le budget et le planning", "Track budget and schedule"],
    ],
  },
  {
    key: "security", weight: 3, occupations: ["security-analyst"],
    titles: { fr: ["Analyste SOC / Cybersécurité", "Ingénieur Sécurité"], en: ["Security Analyst (SOC)"] },
    required: ["cybersecurity", "linux"], optional: ["python", "azure", "aws", "english"],
    salary: [40000, 62000],
    missions: [
      ["Surveiller et qualifier les alertes de sécurité", "Monitor and triage security alerts"],
      ["Mener des analyses d'incidents", "Investigate incidents"],
      ["Sensibiliser les collaborateurs", "Raise employee awareness"],
    ],
  },
  {
    key: "sales", weight: 4, occupations: ["sales-representative"],
    titles: { fr: ["Commercial B2B", "Business Developer"], en: ["Account Executive"] },
    required: ["negotiation", "crm"], optional: ["salesforce", "english", "communication"],
    salary: [30000, 50000],
    missions: [
      ["Prospecter de nouveaux clients", "Prospect new clients"],
      ["Négocier et conclure les contrats", "Negotiate and close contracts"],
      ["Fidéliser le portefeuille existant", "Grow the existing portfolio"],
    ],
  },
  {
    key: "accountant", weight: 3, occupations: ["accountant"],
    titles: { fr: ["Comptable", "Comptable Général"], en: ["Accountant"] },
    required: ["accounting", "excel"], optional: ["sap", "payroll"],
    salary: [30000, 42000],
    missions: [
      ["Tenir la comptabilité générale", "Keep the general ledger"],
      ["Préparer les clôtures mensuelles", "Prepare monthly closings"],
      ["Être l'interlocuteur des commissaires aux comptes", "Work with the auditors"],
    ],
  },
  {
    key: "customer-advisor", weight: 3, occupations: ["customer-advisor"],
    titles: { fr: ["Conseiller Clientèle", "Chargé de Relation Client"], en: ["Customer Service Representative"] },
    required: ["customer-service", "communication"], optional: ["crm", "english", "excel"],
    salary: [22000, 28000],
    missions: [
      ["Répondre aux demandes des clients par téléphone et e-mail", "Answer customer requests by phone and email"],
      ["Traiter les réclamations", "Handle complaints"],
      ["Proposer des solutions adaptées", "Offer suitable solutions"],
    ],
  },
  {
    key: "digital-marketer", weight: 3, occupations: ["digital-marketer"],
    titles: { fr: ["Chargé de Marketing Digital", "Traffic Manager"], en: ["Digital Marketing Specialist"] },
    required: ["seo", "google-ads"], optional: ["excel", "communication", "english"],
    salary: [30000, 42000],
    missions: [
      ["Gérer les campagnes d'acquisition", "Run acquisition campaigns"],
      ["Optimiser le référencement du site", "Optimise the website's SEO"],
      ["Analyser les performances", "Analyse performance"],
    ],
  },
  {
    key: "recruiter", weight: 2, occupations: ["recruiter"],
    titles: { fr: ["Chargé de Recrutement", "Talent Acquisition"], en: ["Talent Acquisition Specialist"] },
    required: ["recruitment", "communication"], optional: ["english", "crm"],
    salary: [32000, 45000],
    missions: [
      ["Rédiger et diffuser les annonces", "Write and publish job ads"],
      ["Mener les entretiens", "Run interviews"],
      ["Accompagner les managers dans leurs recrutements", "Support managers with their hiring"],
    ],
  },
];

// Fictional companies.
const companies = [
  "Nexora", "Atelier Numérique", "DataVerse", "Kalypso Santé", "Logistique Martin", "BlueHarbor",
  "Cabinet Lefèvre & Associés", "Solvéo", "Pixel & Plume", "Hexalabs", "Orbitale Énergie",
  "Banque Coopérative du Sud", "Mobilis Transports", "Fromagerie Durand", "Cloudine", "Assur'Avenir",
  "Groupe Verdier", "Trilobite Games", "EcoBâtiment", "MédiaLink",
];

const contractLabels: Record<ContractType, [fr: string, en: string]> = {
  permanent: ["CDI", "Permanent"],
  fixed_term: ["CDD", "Fixed-term"],
  temporary: ["Intérim", "Temporary"],
  freelance: ["Freelance", "Freelance"],
  internship: ["Stage", "Internship"],
  apprenticeship: ["Alternance", "Apprenticeship"],
  other: ["Autre", "Other"],
};

const remoteLabels: Record<RemoteType, [fr: string, en: string]> = {
  onsite: ["Sur site", "On site"],
  hybrid: ["Hybride (2 à 3 jours par semaine)", "Hybrid (2 to 3 days a week)"],
  remote: ["Télétravail complet", "Fully remote"],
};

const periodLabels: Record<SalaryPeriod, [fr: string, en: string]> = {
  hour: ["de l'heure", "per hour"],
  day: ["par jour", "per day"],
  month: ["par mois", "per month"],
  year: ["par an", "per year"],
};

const skillNames = new Map(skills.map((skill) => [skill.key, skill]));
const locationNames = new Map(locations.map((location) => [location.key, location.name]));

function skillName(key: string, language: "fr" | "en"): string {
  const skill = skillNames.get(key);
  if (!skill) throw new Error(`Unknown skill key in offers: ${key}`);
  return skill[language][0];
}

type DescriptionInput = {
  title: string;
  companyName: string | null;
  language: "fr" | "en";
  locationKey: string | null;
  missions: string[];
  years: number;
  required: string[];
  optional: string[];
  contractType: ContractType | null;
  remoteType: RemoteType | null;
  salary: string | null;
};

// Simplified Markdown (DATABASE.md "Offer description format").
function buildDescription(input: DescriptionInput): string {
  const fr = input.language === "fr";
  const lang = fr ? 0 : 1;
  const place = input.locationKey ? locationNames.get(input.locationKey) : null;
  const required = input.required.map((key) => skillName(key, input.language)).join(", ");
  const optional = input.optional.map((key) => skillName(key, input.language)).join(", ");

  const intro = fr
    ? `${input.companyName ? `**${input.companyName}**` : "Notre client"} recrute un(e) **${input.title}**${place ? ` à ${place}` : ""}.`
    : `${input.companyName ? `**${input.companyName}**` : "Our client"} is hiring a **${input.title}**${place ? ` in ${place}` : ""}.`;

  const lines = [
    intro,
    "",
    fr ? "## Vos missions" : "## What you will do",
    "",
    ...input.missions.map((mission) => `- ${mission}`),
    "",
    fr ? "## Profil recherché" : "## About you",
    "",
    fr ? `- ${input.years} ans d'expérience minimum sur un poste similaire` : `- At least ${input.years} years of experience in a similar role`,
  ];
  if (required) lines.push(fr ? `- Maîtrise de : ${required}` : `- Solid skills in: ${required}`);
  if (optional) lines.push(fr ? `- Seraient un plus : ${optional}` : `- Nice to have: ${optional}`);
  lines.push("", fr ? "## Conditions" : "## What we offer", "");
  if (input.contractType) lines.push(`- ${fr ? "Contrat" : "Contract"} : ${contractLabels[input.contractType][lang]}`);
  if (input.remoteType) lines.push(`- ${fr ? "Télétravail" : "Remote"} : ${remoteLabels[input.remoteType][lang]}`);
  lines.push(`- ${fr ? "Rémunération" : "Salary"} : ${input.salary ?? (fr ? "selon profil" : "depending on experience")}`);

  return lines.join("\n");
}

function formatSalary(min: number | null, max: number | null, currency: string | null, period: SalaryPeriod | null, language: "fr" | "en"): string | null {
  if (min === null || currency === null || period === null) return null;
  const amount = (value: number) => value.toLocaleString(language === "fr" ? "fr-FR" : "en-GB");
  const range = max !== null && max !== min ? `${amount(min)} – ${amount(max)}` : amount(min);
  return `${range} ${currency} ${periodLabels[period][language === "fr" ? 0 : 1]}`;
}

type Salary = Pick<SeedOffer, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">;

const noSalary: Salary = { salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };

function randomSalary(random: Random, profile: Profile, contractType: ContractType, seniority: number): Salary {
  if (random.chance(0.25)) return noSalary;
  const eur = (salaryMin: number, salaryMax: number | null, salaryPeriod: SalaryPeriod): Salary => ({ salaryMin, salaryMax, salaryCurrency: "EUR", salaryPeriod });

  switch (contractType) {
    case "freelance": {
      const min = random.int(35, 60) * 10 + seniority * 50;
      return eur(min, min + random.int(5, 15) * 10, "day");
    }
    case "internship":
      return eur(random.int(65, 140) * 10, null, "month");
    case "apprenticeship":
      return eur(random.int(90, 160) * 10, null, "month");
    case "temporary":
      return eur(random.int(12, 16), random.int(17, 20), "hour");
    default: {
      const [low, high] = profile.salary;
      const step = (high - low) / 2;
      const min = Math.round((low + step * seniority) / 1000) * 1000;
      const max = min + random.int(3, 10) * 1000;
      // Some offers only give a starting salary.
      return random.chance(0.1) ? eur(min, null, "year") : eur(min, max, "year");
    }
  }
}

function randomPublishedHoursAgo(random: Random): number {
  const [min, max] = random.weighted<[number, number]>([
    [[1, 23], 15],            // last 24 h
    [[24, 24 * 7], 35],       // last week
    [[24 * 7, 24 * 30], 40],  // last month
    [[24 * 30, 24 * 60], 10], // older than the "30 days" filter
  ]);
  return random.int(min, max);
}

type Seniority = { fr: string; en: string; years: number; level: number };

const seniorities: Seniority[] = [
  { fr: "Junior", en: "Junior", years: 0, level: 0 },
  { fr: "", en: "", years: 3, level: 1 },
  { fr: "Senior", en: "Senior", years: 5, level: 2 },
];

export function generateOffers(random: Random, count: number): SeedOffer[] {
  const offers: SeedOffer[] = [];
  const profileWeights = profiles.map((profile) => [profile, profile.weight] as const);

  for (let index = 1; index <= count; index++) {
    const profile = random.weighted(profileWeights);
    const language = random.chance(0.15) ? "en" : "fr";
    const seniority = random.weighted<Seniority>([[seniorities[0], 2], [seniorities[1], 5], [seniorities[2], 3]]);
    const baseTitle = random.pick(profile.titles[language]);
    const prefix = seniority[language] ? `${seniority[language]} ` : "";
    const suffix = language === "fr" ? random.pick(["", " H/F", " (H/F)", " - CDI"]) : "";

    const contractType = random.weighted<ContractType>([
      ["permanent", 70], ["fixed_term", 8], ["freelance", 10], ["internship", 5], ["apprenticeship", 4], ["temporary", 3],
    ]);
    const title = `${prefix}${baseTitle}${contractType === "permanent" ? suffix : ""}`.trim();
    const remoteType = random.weighted<RemoteType | null>([["onsite", 40], ["hybrid", 45], ["remote", 10], [null, 5]]);
    const locationKey = random.weighted(offerCityWeights);
    const companyName = random.chance(0.08) ? null : random.pick(companies);
    const salary = randomSalary(random, profile, contractType, seniority.level);

    const optional = random.sample(profile.optional, random.int(1, Math.min(4, profile.optional.length)));
    const missions = profile.missions.map(([fr, en]) => (language === "fr" ? fr : en));
    const published = randomPublishedHoursAgo(random);
    const externalId = `gen-${String(index).padStart(4, "0")}`;

    offers.push({
      key: externalId,
      title,
      companyName,
      language,
      locationKey,
      remoteType,
      contractType,
      ...salary,
      description: buildDescription({
        title, companyName, language, locationKey, missions, years: seniority.years,
        required: profile.required, optional, contractType, remoteType,
        salary: formatSalary(salary.salaryMin, salary.salaryMax, salary.salaryCurrency, salary.salaryPeriod, language),
      }),
      url: `https://jobs.example.com/offers/${externalId}`,
      isPublic: true,
      source: "seed",
      externalId,
      createdByUserKey: null,
      publishedAt: hoursAgo(published),
      closedAt: null,
      skillKeys: [...profile.required, ...optional],
      occupationKeys: profile.occupations,
    });
  }

  return offers;
}

// Hand-written offers covering the search rules and edge cases (FEATURE O1, DATABASE.md
// "locations" and "offers"). Each one says what it is for.
export function edgeCaseOffers(): SeedOffer[] {
  const base = (key: string, fields: Partial<SeedOffer> & Pick<SeedOffer, "title">): SeedOffer => {
    const offer: SeedOffer = {
      key,
      companyName: "Nexora",
      description: "",
      language: "fr",
      url: `https://jobs.example.com/offers/${key}`,
      locationKey: "city:paris",
      remoteType: "hybrid",
      contractType: "permanent",
      ...noSalary,
      isPublic: true,
      source: "seed",
      externalId: key,
      createdByUserKey: null,
      publishedAt: hoursAgo(48),
      closedAt: null,
      skillKeys: ["typescript", "nodejs", "react"],
      occupationKeys: ["fullstack-developer"],
      ...fields,
    };
    if (!offer.description) {
      offer.description = buildDescription({
        title: offer.title, companyName: offer.companyName, language: offer.language, locationKey: offer.locationKey,
        missions: offer.language === "fr" ? ["Développer de nouvelles fonctionnalités"] : ["Build new features"],
        years: 2, required: offer.skillKeys, optional: [], contractType: offer.contractType, remoteType: offer.remoteType,
        salary: formatSalary(offer.salaryMin, offer.salaryMax, offer.salaryCurrency, offer.salaryPeriod, offer.language),
      });
    }
    return offer;
  };

  return [
    // Matches a Brunoy search with a small radius (Brunoy itself).
    base("edge-brunoy-fullstack", {
      title: "Développeur Full Stack Node.js / React H/F", companyName: "Brunoy Digital", locationKey: "city:brunoy",
      salaryMin: 42000, salaryMax: 50000, salaryCurrency: "EUR", salaryPeriod: "year", publishedAt: hoursAgo(3),
      skillKeys: ["typescript", "nodejs", "react", "express", "postgresql", "docker"],
    }),
    // Located at region level: shown "whole region" for a Brunoy / Essonne search, after exact matches.
    base("edge-region-idf", {
      title: "Développeur Back-end Node.js - Île-de-France", locationKey: "region:FR-IDF", companyName: "Mobilis Transports",
      skillKeys: ["nodejs", "typescript", "postgresql", "docker"], occupationKeys: ["backend-developer"],
    }),
    // Located at county level: matches every city in Essonne (91) in an area search.
    base("edge-county-essonne", {
      title: "Technicien Systèmes Linux (Essonne)", locationKey: "county:91", companyName: "Groupe Verdier",
      skillKeys: ["linux", "cybersecurity"], occupationKeys: ["sysadmin"], remoteType: "onsite",
    }),
    // Located at country level: matches every French search.
    base("edge-country-fr", {
      title: "Commercial Itinérant B2B - France entière", locationKey: "country:FR", companyName: "EcoBâtiment",
      skillKeys: ["negotiation", "crm"], occupationKeys: ["sales-representative"], remoteType: "onsite",
      salaryMin: 35000, salaryMax: 55000, salaryCurrency: "EUR", salaryPeriod: "year",
    }),
    // Fully remote, located in Bordeaux: included anywhere in France when "include remote offers" is on.
    base("edge-remote-bordeaux", {
      title: "Développeur Full Stack TypeScript - 100 % télétravail", locationKey: "city:bordeaux", remoteType: "remote",
      companyName: "Cloudine", skillKeys: ["typescript", "nodejs", "react", "graphql"],
    }),
    // Fully remote with no location at all.
    base("edge-remote-no-location", {
      title: "Remote Backend Engineer (Node.js)", language: "en", locationKey: null, remoteType: "remote",
      companyName: "Hexalabs", skillKeys: ["nodejs", "typescript", "postgresql", "aws"], occupationKeys: ["backend-developer"],
      salaryMin: 55000, salaryMax: 70000, salaryCurrency: "EUR", salaryPeriod: "year",
    }),
    // Remote but in Belgium: must NOT match French searches.
    base("edge-remote-belgium", {
      title: "Développeur React - Full remote (Belgique)", locationKey: "city:bruxelles", remoteType: "remote",
      companyName: "Solvéo", skillKeys: ["react", "typescript"], occupationKeys: ["frontend-developer"],
    }),
    // Closed: hidden from search, still reachable from the demo user's saved list.
    base("edge-closed", {
      title: "Développeur Full Stack JavaScript (offre pourvue)", companyName: "Atelier Numérique",
      publishedAt: hoursAgo(24 * 20), closedAt: hoursAgo(24 * 2),
    }),
    // Private user-added offer (FEATURE O5): never in search, visible to its creator.
    base("edge-private-user", {
      title: "Développeur TypeScript - candidature spontanée", companyName: "Fromagerie Durand", url: null,
      isPublic: false, source: "user", externalId: null, createdByUserKey: "demo", publishedAt: null,
      description: "Texte collé par l'utilisateur.\n\nPoste de développeur TypeScript pour notre outil de gestion des stocks.\nContact : rh@fromagerie-durand.example",
    }),
    // No extracted skills: match % shows "Not enough data".
    base("edge-no-skills", {
      title: "Assistant(e) Administratif(ve)", companyName: "Cabinet Lefèvre & Associés", skillKeys: [], occupationKeys: [],
      remoteType: "onsite", contractType: "fixed_term",
    }),
    // Skills but no occupation: match % uses the skill score only.
    base("edge-no-occupation", {
      title: "Développeur Node.js (mission courte)", occupationKeys: [], contractType: "freelance",
      salaryMin: 450, salaryMax: 550, salaryCurrency: "EUR", salaryPeriod: "day",
    }),
    // Salary in another currency: excluded by a minimum-salary filter in EUR.
    base("edge-salary-usd", {
      title: "Senior Fullstack Engineer (US company, Paris office)", language: "en", companyName: "BlueHarbor",
      salaryMin: 90000, salaryMax: 120000, salaryCurrency: "USD", salaryPeriod: "year",
    }),
    // Hourly salary (temporary work).
    base("edge-salary-hourly", {
      title: "Préparateur de commandes - Intérim", companyName: "Logistique Martin", locationKey: "city:evry",
      contractType: "temporary", remoteType: "onsite", salaryMin: 12, salaryMax: 13, salaryCurrency: "EUR", salaryPeriod: "hour",
      skillKeys: ["teamwork"], occupationKeys: [],
    }),
    // Internship with a monthly allowance.
    base("edge-internship", {
      title: "Stage - Développeur Web (6 mois)", companyName: "Pixel & Plume", locationKey: "city:massy",
      contractType: "internship", salaryMin: 1200, salaryMax: null, salaryCurrency: "EUR", salaryPeriod: "month",
      skillKeys: ["javascript", "html", "css", "git"], occupationKeys: ["software-developer"],
    }),
    // Title without accents, as some sources write it: keyword "développeur" should still find it (trigram).
    base("edge-no-accents", {
      title: "Developpeur fullstack junior", companyName: null, locationKey: "city:palaiseau",
    }),
    // Published 45 days ago: excluded by the "30 days" filter.
    base("edge-old", {
      title: "Développeur React Native", companyName: "Trilobite Games", publishedAt: hoursAgo(24 * 45),
      skillKeys: ["react", "javascript"], occupationKeys: ["mobile-developer"],
    }),
    // No published date (some sources don't give one).
    base("edge-no-published-date", {
      title: "Ingénieur DevOps AWS", companyName: "Orbitale Énergie", publishedAt: null, locationKey: "city:lyon",
      skillKeys: ["aws", "terraform", "docker", "kubernetes"], occupationKeys: ["devops-engineer"],
    }),
    // Unknown contract and remote type.
    base("edge-unknown-contract", {
      title: "Data Analyst", companyName: "DataVerse", contractType: null, remoteType: null, locationKey: "city:lille",
      skillKeys: ["sql", "power-bi"], occupationKeys: ["data-analyst"],
    }),
    // Description with HTML and a link: the frontend must escape the HTML (D29).
    base("edge-html-in-description", {
      title: "Développeur Front-end Vue.js", companyName: "MédiaLink", skillKeys: ["vue", "javascript", "css"],
      occupationKeys: ["frontend-developer"],
      description: [
        "**MédiaLink** recrute un(e) développeur(se) front-end.",
        "",
        "<script>alert('xss')</script>",
        "",
        "## Vos missions",
        "",
        "- Développer nos *widgets* embarqués",
        "- Voir [notre blog technique](https://medialink.example/blog)",
        "",
        "<b>Postulez vite !</b>",
      ].join("\n"),
    }),
    // Very long description (rendering, truncation in result cards).
    base("edge-long-description", {
      title: "Architecte Logiciel", companyName: "Banque Coopérative du Sud", locationKey: "city:toulouse",
      skillKeys: ["java", "spring", "kubernetes", "aws"], occupationKeys: ["software-developer"],
      description: Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`).join("\n\n"),
    }),
  ];
}
