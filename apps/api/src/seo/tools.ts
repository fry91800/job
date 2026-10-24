import { escapeHtml } from "@job/shared/src/markdown";
import { config } from "../config";
import { breadcrumbs, landingDocument, type LandingPage } from "./landing";

// Tool pages (SEO.md "Tool pages"): what people search before applying ("adapter son CV à
// une offre", "CV alternance", "CV stage"), as server pages explaining the tool, each with
// its own text for its readers, leading to the app's guided path (/adapter-mon-cv). What
// they promise is what the app does: the generation rules (generated-resumes/
// resume-modifier.ts), the limits (config.limits), the guests' data deletion
// (config.cleanup).

export const TOOL_START = "/adapter-mon-cv"; // the app's guided path (apps/web tabs/model.ts)

type Faq = [question: string, answer: string];
type Tool = { path: string; title: string; heading: string; description: string; crumb: string; intro: string[]; sections: { title: string; paragraphs?: string[]; items?: string[] }[]; faq: Faq[]; see: { href: string; label: string }[] };

const steps = {
  title: "Comment ça marche",
  items: [
    "Importez votre CV, en PDF ou Word : il est lu automatiquement, vous pouvez le corriger.",
    "Ajoutez l'offre : collez son adresse (sur n'importe quel site d'emploi ou site carrières) ou son texte.",
    "Choisissez le niveau d'adaptation et un modèle, puis téléchargez votre CV adapté en PDF.",
  ],
};

const never = {
  title: "Ce que l'IA change, et ce qu'elle ne change jamais",
  paragraphs: ["Votre CV est réécrit avec le vocabulaire de l'offre : le résumé, le titre, l'ordre et la formulation des compétences et des missions. Chaque modification est visible, et vous gardez la main sur le résultat."],
  items: [
    "Jamais changés : vos employeurs, intitulés de poste, dates, diplômes, certifications et coordonnées.",
    "Jamais ajoutés : une expérience, une formation ou une mission que vous n'avez pas.",
    "Trois niveaux : léger (reformule avec les mots de l'offre), moyen (met en avant l'expérience utile), fort (peut ajouter des compétences que l'offre demande — à vérifier avant d'envoyer).",
  ],
};

const commonFaq = (limits: typeof config.limits): Faq[] => [
  ["Est-ce gratuit ?", `Oui. Sans compte, vous pouvez générer ${limits.aiGenerations.guestTotal} CV adaptés ; avec un compte gratuit, jusqu'à ${limits.aiGenerations.registeredPerDay} par jour.`],
  ["Que deviennent mes données ?", `Votre CV n'est visible que par vous. Sans compte, il est supprimé après ${config.cleanup.guestInactiveDays} jours sans visite ; avec un compte, vous le supprimez quand vous voulez.`],
  ["Le CV passe-t-il les logiciels de recrutement (ATS) ?", "Oui : le PDF contient du vrai texte, dans l'ordre de lecture, avec des titres de rubriques standards, que les logiciels de tri lisent correctement. Huit modèles au choix, avec ou sans photo."],
  ["Et si l'offre est en anglais ?", "MonPoste vous propose de traduire d'abord votre CV dans la langue de l'offre, ou d'utiliser un CV que vous avez déjà dans cette langue."],
];

const TOOLS: Tool[] = [
  {
    path: "/adapter-son-cv",
    title: "Adapter son CV à une offre d'emploi, gratuitement",
    heading: "Adapter son CV à une offre d'emploi",
    description: "Adaptez votre CV à chaque offre d'emploi en quelques minutes : importez votre CV, collez l'offre, téléchargez un CV réécrit avec ses mots. Gratuit, sans inscription.",
    crumb: "Adapter son CV",
    intro: [
      "Un recruteur passe quelques secondes sur un CV, et beaucoup d'entreprises le font d'abord trier par un logiciel qui cherche les mots de l'offre. Un CV adapté à chaque offre — son vocabulaire, ses compétences, son intitulé de poste — est plus souvent lu en entier.",
      "MonPoste le fait pour vous à partir de votre CV et de l'offre qui vous intéresse, en restant fidèle à votre parcours.",
    ],
    sections: [steps, never],
    faq: [],
    see: [
      { href: "/adapter-son-cv/alternance", label: "Adapter son CV pour une alternance" },
      { href: "/adapter-son-cv/stage", label: "Adapter son CV pour un stage" },
      { href: "/emplois", label: "Trouver une offre d'emploi" },
    ],
  },
  {
    path: "/adapter-son-cv/alternance",
    title: "CV pour une alternance : l'adapter à chaque offre, gratuitement",
    heading: "CV pour une alternance : l'adapter à chaque offre",
    description: "Votre CV d'alternance adapté à chaque offre : formation, rythme et compétences mis en avant avec les mots de l'entreprise. Gratuit, sans inscription.",
    crumb: "CV pour une alternance",
    intro: [
      "Pour une alternance, l'entreprise recrute autant une formation qu'une personne : elle regarde le diplôme préparé, l'école, le rythme et la date de début, puis ce que vous savez déjà faire. Avec peu d'expérience, chaque ligne du CV compte, et elle doit parler la langue de l'offre.",
      "MonPoste réécrit votre CV pour chaque offre d'alternance à partir de ce que vous avez réellement fait — études, projets, jobs, stages — sans rien inventer.",
    ],
    sections: [
      { title: "Ce qu'un CV d'alternance doit montrer", items: ["Le diplôme préparé, l'école et le rythme (par exemple « 3 semaines en entreprise, 1 semaine en formation »), dès le titre ou le résumé.", "La date de début possible et la durée du contrat.", "Les projets d'études et les expériences courtes qui prouvent les compétences demandées.", "Les mots de l'offre : outils, missions, savoir-être cités par l'entreprise."] },
      steps,
      never,
    ],
    faq: [["Je n'ai presque pas d'expérience, ça marche quand même ?", "Oui : vos projets, vos études et vos expériences courtes sont mis en avant et reformulés pour l'offre. Rien n'est ajouté que vous n'avez pas fait ; au niveau fort, des compétences demandées peuvent être proposées, à vérifier avant d'envoyer."]],
    see: [
      { href: "/alternance", label: "Les offres en alternance" },
      { href: "/adapter-son-cv/stage", label: "Adapter son CV pour un stage" },
      { href: "/adapter-son-cv", label: "Adapter son CV à une offre d'emploi" },
    ],
  },
  {
    path: "/adapter-son-cv/stage",
    title: "CV pour un stage : l'adapter à chaque offre, gratuitement",
    heading: "CV pour un stage : l'adapter à chaque offre",
    description: "Votre CV de stage adapté à chaque offre : formation, dates et compétences mises en avant avec les mots de l'entreprise. Gratuit, sans inscription.",
    crumb: "CV pour un stage",
    intro: [
      "Une offre de stage attire souvent des dizaines de candidatures d'étudiants aux parcours proches. Ce qui fait la différence : un CV qui reprend les missions et les outils de l'offre, et qui dit clairement la formation, la durée et les dates du stage.",
      "MonPoste réécrit votre CV pour chaque offre de stage à partir de votre parcours réel, en quelques minutes.",
    ],
    sections: [
      { title: "Ce qu'un CV de stage doit montrer", items: ["La formation en cours, l'école et l'année d'études.", "La durée du stage et les dates possibles, avec la convention de stage si l'école la fournit.", "Les projets, travaux de groupe et expériences qui correspondent aux missions de l'offre.", "Les outils et langues demandés, avec votre niveau réel."] },
      steps,
      never,
    ],
    faq: [["Puis-je adapter le même CV à plusieurs stages ?", "Oui : votre CV reste tel quel, et chaque offre a son propre CV adapté, que vous retrouvez dans « CV générés »."]],
    see: [
      { href: "/stage", label: "Les offres de stage" },
      { href: "/adapter-son-cv/alternance", label: "Adapter son CV pour une alternance" },
      { href: "/adapter-son-cv", label: "Adapter son CV à une offre d'emploi" },
    ],
  },
];

export const toolPaths = () => TOOLS.map((tool) => tool.path);

const cta = (label: string) => `<p><a class="landing-cta" href="${TOOL_START}">${escapeHtml(label)}</a></p>`;

export function toolPage(path: string): LandingPage | null {
  const tool = TOOLS.find((item) => item.path === path);
  if (!tool) return null;
  const faq = [...tool.faq, ...commonFaq(config.limits)];
  const trail = breadcrumbs([{ name: config.seo.siteName, path: "/" }, ...(tool.path === "/adapter-son-cv" ? [] : [{ name: "Adapter son CV", path: "/adapter-son-cv" }]), { name: tool.crumb, path: tool.path }]);
  const body = `${trail.html}
<h1>${escapeHtml(tool.heading)}</h1>
${tool.intro.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
${cta("Adapter mon CV maintenant — gratuit")}
${tool.sections
  .map((section) => `<h2>${escapeHtml(section.title)}</h2>${(section.paragraphs ?? []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}${section.items ? `<${section === steps ? "ol" : "ul"} class="landing-list">${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${section === steps ? "ol" : "ul"}>` : ""}`)
  .join("\n")}
<h2>Questions fréquentes</h2>
${faq.map(([question, answer]) => `<h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p>`).join("\n")}
${cta("Commencer avec mon CV")}
<h2>Voir aussi</h2><ul class="landing-links">${tool.see.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`).join("")}</ul>`;
  const application = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${config.seo.siteName} — ${tool.heading}`,
    url: `${config.webBaseUrl}${tool.path}`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "fr",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  };
  return { status: 200, html: landingDocument({ title: tool.title, description: tool.description, path: tool.path, body, data: [trail.data, application] }) };
}
