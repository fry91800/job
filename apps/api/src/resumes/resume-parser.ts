import type { ResumeContentInput, ResumeLanguage } from "@job/shared";

// PLACEHOLDER for resume parsing (FEATURE R2). The real version extracts the text of the
// PDF/DOCX and asks the AI to convert it to ResumeContent v1. Until then every upload
// returns this same resume, whatever the file contains.
export async function parseResumeFile(_file: Buffer, _type: "pdf" | "docx"): Promise<{ content: ResumeContentInput; language: ResumeLanguage }> {
  return {
    language: "fr",
    content: {
      schemaVersion: 1,
      basics: {
        fullName: "Jean Dupont",
        title: "Développeur back-end",
        email: "jean.dupont@example.com",
        phone: "06 12 34 56 78",
        location: { city: "Lyon", region: "Auvergne-Rhône-Alpes", country: "France" },
        links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/example" }],
      },
      summary: "Développeur back-end avec 6 ans d'expérience sur des API Java et Node.js à fort trafic.",
      skills: [
        { name: "Java", category: "technical" },
        { name: "Spring Boot", category: "technical" },
        { name: "Node.js", category: "technical" },
        { name: "PostgreSQL", category: "technical" },
        { name: "Docker", category: "technical" },
        { name: "Kubernetes", category: "technical" },
        { name: "Travail en équipe", category: "soft" },
      ],
      workExperience: [
        {
          jobTitle: "Développeur back-end",
          company: "Mobilis Transports",
          location: "Lyon",
          startDate: "2021-03",
          endDate: null,
          isCurrent: true,
          responsibilities: [
            { text: "Développement des API de réservation utilisées par 2 millions de voyageurs." },
            { text: "Migration des services vers Kubernetes." },
          ],
          technologies: ["Java", "Spring Boot", "Kubernetes"],
        },
        {
          jobTitle: "Développeur Java",
          company: "Groupe Verdier",
          location: "Villeurbanne",
          startDate: "2018-09",
          endDate: "2021-02",
          isCurrent: false,
          responsibilities: [{ text: "Maintenance et évolution de l'outil de facturation." }],
          technologies: ["Java", "MySQL"],
        },
      ],
      projects: [],
      education: [
        { degree: "Master Informatique", institution: "Université Lyon 1", location: "Villeurbanne", startDate: "2016", endDate: "2018", description: null },
      ],
      languages: [
        { language: "Français", level: "Langue maternelle" },
        { language: "Anglais", level: "C1" },
      ],
      certifications: [],
      interests: ["Vélo"],
    },
  };
}
