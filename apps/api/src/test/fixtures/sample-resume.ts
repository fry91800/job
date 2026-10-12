import type { ResumeContentInput } from "@job/shared";

// Answer of the fake AI for resume parsing in tests.
export const sampleParsedResume: { language: "fr"; content: ResumeContentInput } = {
  language: "fr",
  content: {
    schemaVersion: 1,
    basics: {
      fullName: "Jean Dupont",
      title: "Développeur back-end",
      email: "jean.dupont@example.com",
      phone: null,
      location: { city: "Lyon", region: null, country: "France" },
      links: [],
    },
    summary: "Développeur back-end avec 6 ans d'expérience.",
    skills: [
      { name: "Java", category: "technical" },
      { name: "Node.js", category: "technical" },
      { name: "PostgreSQL", category: "technical" },
    ],
    workExperience: [
      {
        jobTitle: "Développeur back-end",
        company: "Mobilis Transports",
        location: "Lyon",
        startDate: "2021-03",
        endDate: null,
        isCurrent: true,
        responsibilities: [{ text: "Développement des API de réservation." }],
        technologies: ["Java", "Kubernetes"],
      },
    ],
    projects: [],
    education: [],
    languages: [],
    certifications: [],
    interests: [],
  },
};
