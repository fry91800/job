import type { ResumeContent } from "@job/shared";

// A fictional resume for the template previews (`npm run templates:previews`) and tests:
// every section filled, long enough to show how a template handles a second page.

export const SAMPLE_RESUME: ResumeContent = {
  schemaVersion: 1,
  basics: {
    fullName: "Camille Laurent",
    title: "Cheffe de projet digital",
    email: "camille.laurent@exemple.fr",
    phone: "06 12 34 56 78",
    location: { city: "Lyon", region: "Auvergne-Rhône-Alpes", country: "France" },
    links: [
      { id: "l1", label: "linkedin.com/in/camille-laurent", url: "https://www.linkedin.com/in/camille-laurent" },
      { id: "l2", label: "camillelaurent.fr", url: "https://camillelaurent.fr" },
    ],
  },
  summary:
    "Cheffe de projet digital avec 7 ans d'expérience en agence et chez l'annonceur. Je pilote des refontes de sites et d'applications de la conception à la mise en ligne, en coordonnant équipes techniques, design et métiers, avec un goût prononcé pour la mesure et l'amélioration continue.",
  skills: [
    { id: "s1", name: "Gestion de projet agile", category: "technical" },
    { id: "s2", name: "Scrum", category: "technical" },
    { id: "s3", name: "Jira", category: "technical" },
    { id: "s4", name: "Figma", category: "technical" },
    { id: "s5", name: "Google Analytics 4", category: "technical" },
    { id: "s6", name: "SEO", category: "technical" },
    { id: "s7", name: "UX research", category: "technical" },
    { id: "s8", name: "SQL", category: "technical" },
    { id: "s9", name: "Communication", category: "soft" },
    { id: "s10", name: "Leadership", category: "soft" },
    { id: "s11", name: "Organisation", category: "soft" },
  ],
  workExperience: [
    {
      id: "w1",
      jobTitle: "Cheffe de projet digital senior",
      company: "Maison Varenne",
      location: "Lyon",
      startDate: "2022-03",
      endDate: null,
      isCurrent: true,
      responsibilities: [
        { id: "r1", text: "Pilotage de la refonte du site e-commerce (12 personnes, budget de 450 k€), mise en ligne dans les délais." },
        { id: "r2", text: "Hausse de 18 % du taux de conversion mobile grâce à un programme de tests A/B." },
        { id: "r3", text: "Animation des rituels agiles et arbitrage des priorités avec les équipes marketing et logistique." },
        { id: "r4", text: "Recrutement et accompagnement de deux chefs de projet juniors." },
      ],
      technologies: ["Jira", "Figma", "Shopify Plus", "GA4"],
    },
    {
      id: "w2",
      jobTitle: "Cheffe de projet web",
      company: "Agence Hublot",
      location: "Lyon",
      startDate: "2019-01",
      endDate: "2022-02",
      isCurrent: false,
      responsibilities: [
        { id: "r5", text: "Gestion d'un portefeuille de 15 clients (culture, tourisme, industrie) et de leurs projets web." },
        { id: "r6", text: "Rédaction des cahiers des charges, suivi des développements et recettes fonctionnelles." },
        { id: "r7", text: "Mise en place d'un tableau de bord de suivi de la rentabilité des projets." },
      ],
      technologies: ["WordPress", "Drupal", "Trello"],
    },
    {
      id: "w3",
      jobTitle: "Chargée de projet digital",
      company: "Office de tourisme du Grand Lyon",
      location: "Lyon",
      startDate: "2017-09",
      endDate: "2018-12",
      isCurrent: false,
      responsibilities: [
        { id: "r8", text: "Lancement de l'application de visite de la ville (40 000 téléchargements la première année)." },
        { id: "r9", text: "Coordination des contenus avec les partenaires culturels et traduction en quatre langues." },
      ],
      technologies: [],
    },
    {
      id: "w4",
      jobTitle: "Assistante marketing (alternance)",
      company: "Groupe Ardent",
      location: "Villeurbanne",
      startDate: "2015-09",
      endDate: "2017-08",
      isCurrent: false,
      responsibilities: [
        { id: "r10", text: "Gestion des campagnes d'e-mailing et suivi des indicateurs de performance." },
        { id: "r11", text: "Organisation de trois salons professionnels par an." },
      ],
      technologies: [],
    },
  ],
  projects: [
    {
      id: "p1",
      name: "Guide des bonnes pratiques d'accessibilité",
      description: "Guide interne pour rendre les sites de l'entreprise conformes au RGAA, adopté par toutes les équipes produit.",
      technologies: [],
      link: "https://camillelaurent.fr/accessibilite",
      highlights: [{ id: "h1", text: "Score d'accessibilité moyen passé de 62 à 91 en un an." }],
    },
  ],
  education: [
    {
      id: "e1",
      degree: "Master Management de projets numériques",
      institution: "IAE Lyon",
      location: "Lyon",
      startDate: "2015",
      endDate: "2017",
      description: "En alternance. Mémoire : la mesure de la valeur dans les projets agiles.",
    },
    { id: "e2", degree: "Licence Information-communication", institution: "Université Lumière Lyon 2", location: "Lyon", startDate: "2012", endDate: "2015", description: null },
  ],
  languages: [
    { id: "g1", language: "Français", level: "Langue maternelle" },
    { id: "g2", language: "Anglais", level: "C1" },
    { id: "g3", language: "Espagnol", level: "B2" },
  ],
  certifications: [
    { id: "c1", name: "Professional Scrum Master I", issuer: "Scrum.org", date: "2021-06" },
    { id: "c2", name: "Google Analytics 4", issuer: "Google", date: "2023-02" },
  ],
  interests: ["Photographie argentique", "Randonnée", "Bénévolat (association de lecture)"],
};

// A neutral illustrated portrait (no real person), for the templates that show a photo.
export const SAMPLE_PHOTO = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#d9dee5"/><circle cx="60" cy="48" r="22" fill="#9aa5b4"/><path d="M18 120c4-26 22-38 42-38s38 12 42 38z" fill="#9aa5b4"/></svg>`,
).toString("base64")}`;
