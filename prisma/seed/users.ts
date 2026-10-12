import type { ModifierStrength, SavedOfferStatus } from "@prisma/client";
import { hoursAgo } from "./helpers";

export type SeedUser = {
  key: string;
  email: string | null;
  password: string | null;
  uiLanguage: "fr" | "en";
  searchLocationKey: string | null;
  modifierEnabled: boolean;
  modifierStrength: ModifierStrength;
  // Raw session token. Only its SHA-256 is stored (DECISIONS.md, assumption 1).
  sessionToken: string;
};

export const users: SeedUser[] = [
  // Registered user with resumes, saved offers and a saved search location.
  { key: "demo", email: "demo@example.com", password: "demo-password", uiLanguage: "fr", searchLocationKey: "city:brunoy", modifierEnabled: true, modifierStrength: "medium", sessionToken: "dev-session-demo" },
  // Registered user with nothing yet: no resume, so the match % asks to add one.
  { key: "alice", email: "alice@example.com", password: "alice-password", uiLanguage: "en", searchLocationKey: null, modifierEnabled: false, modifierStrength: "soft", sessionToken: "dev-session-alice" },
  // Guest (P1): no email or password, identified by its session only.
  { key: "guest", email: null, password: null, uiLanguage: "fr", searchLocationKey: null, modifierEnabled: false, modifierStrength: "soft", sessionToken: "dev-session-guest" },
];

export type SeedResume = {
  key: string;
  userKey: string;
  name: string;
  language: "fr" | "en";
  translatedFromKey: string | null;
  selected: boolean;
  occupationKeys: string[];
  content: object;
};

// ResumeContent v1 (DATABASE.md).
const demoResumeFr = {
  schemaVersion: 1,
  basics: {
    fullName: "Camille Martin",
    title: "Développeuse Full Stack",
    email: "demo@example.com",
    phone: null,
    location: { city: "Brunoy", region: "Île-de-France", country: "France" },
    links: [{ id: "l1", label: "GitHub", url: "https://github.com/example" }],
  },
  summary: "Développeuse full stack avec 4 ans d'expérience sur des applications web Node.js et React.",
  skills: [
    { id: "s1", name: "TypeScript", category: "technical" },
    { id: "s2", name: "JavaScript", category: "technical" },
    { id: "s3", name: "Node.js", category: "technical" },
    { id: "s4", name: "Express", category: "technical" },
    { id: "s5", name: "React", category: "technical" },
    { id: "s6", name: "PostgreSQL", category: "technical" },
    { id: "s7", name: "Git", category: "technical" },
    { id: "s8", name: "API REST", category: "technical" },
    { id: "s9", name: "Communication", category: "soft" },
    { id: "s10", name: "Travail en équipe", category: "soft" },
  ],
  workExperience: [
    {
      id: "w1",
      jobTitle: "Développeuse Full Stack",
      company: "Atelier Numérique",
      location: "Paris",
      startDate: "2023-01",
      endDate: null,
      isCurrent: true,
      responsibilities: [
        { id: "r1", text: "Conception et maintenance de deux applications web utilisées par toute l'entreprise." },
        { id: "r2", text: "Mise en place de l'intégration continue et des tests automatisés." },
      ],
      technologies: ["Node.js", "React", "PostgreSQL", "Docker"],
    },
    {
      id: "w2",
      jobTitle: "Développeuse Web",
      company: "Pixel & Plume",
      location: "Massy",
      startDate: "2021-09",
      endDate: "2022-12",
      isCurrent: false,
      responsibilities: [{ id: "r3", text: "Développement de sites vitrines et d'une boutique en ligne." }],
      technologies: ["JavaScript", "PHP", "MySQL"],
    },
  ],
  projects: [
    {
      id: "p1",
      name: "Suivi de candidatures",
      description: "Application personnelle de suivi des candidatures.",
      technologies: ["TypeScript", "Express"],
      link: null,
      highlights: [{ id: "h1", text: "API REST documentée et testée." }],
    },
  ],
  education: [
    { id: "e1", degree: "Licence professionnelle Développement web", institution: "Université d'Évry", location: "Évry", startDate: "2020", endDate: "2021", description: null },
  ],
  languages: [
    { id: "g1", language: "Français", level: "Langue maternelle" },
    { id: "g2", language: "Anglais", level: "B2" },
  ],
  certifications: [],
  interests: ["Randonnée"],
};

// Translation of the French resume (T1): same ids, order and technical terms.
const demoResumeEn = {
  ...demoResumeFr,
  basics: { ...demoResumeFr.basics, title: "Full Stack Developer" },
  summary: "Full stack developer with 4 years of experience building Node.js and React web applications.",
  skills: demoResumeFr.skills.map((skill) =>
    skill.id === "s8" ? { ...skill, name: "REST API" } : skill.id === "s10" ? { ...skill, name: "Teamwork" } : skill,
  ),
  workExperience: [
    {
      ...demoResumeFr.workExperience[0],
      jobTitle: "Full Stack Developer",
      responsibilities: [
        { id: "r1", text: "Designed and maintained two web applications used across the company." },
        { id: "r2", text: "Set up continuous integration and automated tests." },
      ],
    },
    {
      ...demoResumeFr.workExperience[1],
      jobTitle: "Web Developer",
      responsibilities: [{ id: "r3", text: "Built showcase websites and an online shop." }],
    },
  ],
  projects: [
    {
      ...demoResumeFr.projects[0],
      name: "Application tracker",
      description: "Personal application to track job applications.",
      highlights: [{ id: "h1", text: "Documented and tested REST API." }],
    },
  ],
  education: [{ ...demoResumeFr.education[0], degree: "Professional bachelor's degree in web development" }],
  languages: [
    { id: "g1", language: "French", level: "Native" },
    { id: "g2", language: "English", level: "B2" },
  ],
  interests: ["Hiking"],
};

export const resumes: SeedResume[] = [
  { key: "demo-fr", userKey: "demo", name: "CV Full Stack", language: "fr", translatedFromKey: null, selected: true, occupationKeys: ["fullstack-developer"], content: demoResumeFr },
  { key: "demo-en", userKey: "demo", name: "CV Full Stack (EN)", language: "en", translatedFromKey: "demo-fr", selected: false, occupationKeys: ["fullstack-developer"], content: demoResumeEn },
];

export type SeedSavedOffer = {
  userKey: string;
  offerKey: string;
  status: SavedOfferStatus;
  notes: string | null;
  appliedAt: Date | null;
  statusChangedAt: Date;
};

// One saved offer per status, including a closed offer and the user's private offer.
export const savedOffers: SeedSavedOffer[] = [
  { userKey: "demo", offerKey: "edge-brunoy-fullstack", status: "applied", notes: "Candidature envoyée via le site.", appliedAt: hoursAgo(24), statusChangedAt: hoursAgo(24) },
  { userKey: "demo", offerKey: "edge-remote-bordeaux", status: "interviewing", notes: "Entretien technique jeudi.", appliedAt: hoursAgo(24 * 6), statusChangedAt: hoursAgo(24 * 2) },
  { userKey: "demo", offerKey: "edge-region-idf", status: "saved", notes: null, appliedAt: null, statusChangedAt: hoursAgo(5) },
  { userKey: "demo", offerKey: "edge-closed", status: "rejected", notes: null, appliedAt: hoursAgo(24 * 15), statusChangedAt: hoursAgo(24 * 3) },
  { userKey: "demo", offerKey: "edge-private-user", status: "saved", notes: null, appliedAt: null, statusChangedAt: hoursAgo(24 * 4) },
  { userKey: "demo", offerKey: "edge-salary-usd", status: "offer_received", notes: "Offre reçue, à comparer.", appliedAt: hoursAgo(24 * 20), statusChangedAt: hoursAgo(10) },
  { userKey: "demo", offerKey: "edge-no-occupation", status: "withdrawn", notes: null, appliedAt: hoursAgo(24 * 9), statusChangedAt: hoursAgo(24 * 7) },
  { userKey: "guest", offerKey: "edge-brunoy-fullstack", status: "saved", notes: null, appliedAt: null, statusChangedAt: hoursAgo(2) },
];
