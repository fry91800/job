import { escapeHtml } from "@job/shared/src/markdown";
import { config } from "../config";
import { breadcrumbs, landingDocument, type LandingPage } from "./landing";

// Tool pages (SEO.md "Tool pages"): what people search before applying ("adapter son CV à
// une offre", "CV alternance", "lettre de motivation", "lettre de motivation stage"…), as
// server pages explaining the tool, each with its own text for its readers, leading to the
// app's guided paths (/adapter-mon-cv, /ma-lettre-de-motivation, /creer-mon-cv). What
// they promise is what the app does: the generation rules (generated-resumes/
// resume-modifier.ts), the limits (config.limits), the guests' data deletion
// (config.cleanup).

export const TOOL_START = "/adapter-mon-cv"; // the app's guided paths (apps/web tabs/model.ts)
export const LETTER_START = "/ma-lettre-de-motivation";
export const CREATE_START = "/creer-mon-cv";

type Faq = [question: string, answer: string];
type Tool = {
  path: string;
  title: string;
  heading: string;
  description: string;
  crumbs: { name: string; path: string }[]; // between the home page and this page
  crumb: string;
  intro: string[];
  sections: { title: string; paragraphs?: string[]; items?: string[]; ordered?: boolean }[];
  faq: Faq[];
  see: { href: string; label: string }[];
  start: string; // where the buttons lead
  cta: [top: string, bottom: string];
  application: string; // the WebApplication's name
};

const steps = {
  ordered: true,
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

const resumeFaq = (limits: typeof config.limits): Faq[] => [
  ["Je n'ai pas de CV, comment faire ?", "Créez-le en quelques minutes avec l'assistant : vos expériences et votre formation avec vos mots, les compétences que les employeurs demandent pour le poste visé, et une reformulation par l'IA si vous le souhaitez."],
  ["Est-ce gratuit ?", `Oui. Sans compte, vous pouvez générer ${limits.aiGenerations.guestTotal} CV adaptés ; avec un compte gratuit, jusqu'à ${limits.aiGenerations.registeredPerDay} par jour.`],
  ["Que deviennent mes données ?", `Votre CV n'est visible que par vous. Sans compte, il est supprimé après ${config.cleanup.guestInactiveDays} jours sans visite ; avec un compte, vous le supprimez quand vous voulez.`],
  ["Le CV passe-t-il les logiciels de recrutement (ATS) ?", "Oui : le PDF contient du vrai texte, dans l'ordre de lecture, avec des titres de rubriques standards, que les logiciels de tri lisent correctement. Huit modèles au choix, avec ou sans photo."],
  ["Et si l'offre est en anglais ?", "MonPoste vous propose de traduire d'abord votre CV dans la langue de l'offre, ou d'utiliser un CV que vous avez déjà dans cette langue."],
];

const letterSteps = {
  ordered: true,
  title: "Comment ça marche",
  items: [
    "Importez votre CV, en PDF ou Word : la lettre est écrite à partir de votre parcours.",
    "Ajoutez l'offre : collez son adresse (sur n'importe quel site d'emploi ou site carrières) ou son texte.",
    "Votre lettre est rédigée en quelques secondes, dans la langue de l'offre. Relisez-la, modifiez-la, puis copiez le texte ou téléchargez-la en PDF, mise en page.",
  ],
};

const letterRules = {
  title: "Une lettre qui vous ressemble, sans rien inventer",
  paragraphs: ["La lettre s'appuie uniquement sur ce que dit votre CV et sur ce que dit l'offre. Elle suit la structure que les recruteurs attendent : l'offre et l'entreprise, ce que vous apportez, puis votre disponibilité."],
  items: [
    "Jamais inventés : une expérience, un chiffre, un résultat, une qualité ou une information sur l'entreprise.",
    "Pas de formules creuses (« dynamique et motivé », « je me permets de… ») : des éléments concrets de votre parcours, liés aux besoins de l'offre.",
    "Une page, 220 à 350 mots, avec les formules de politesse d'usage — et rien qui reste à compléter entre crochets.",
  ],
};

const letterFaq = (limits: typeof config.limits): Faq[] => [
  ["Je n'ai pas de CV, comment faire ?", "Créez-le en quelques minutes avec l'assistant : vos expériences et votre formation avec vos mots, les compétences que les employeurs demandent pour le poste visé, et une reformulation par l'IA si vous le souhaitez."],
  ["Est-ce gratuit ?", `Oui. Sans compte, vous pouvez écrire ${limits.coverLetters.guestTotal} lettres de motivation ; avec un compte gratuit, jusqu'à ${limits.coverLetters.registeredPerDay} par jour.`],
  ["Puis-je modifier la lettre ?", "Oui, entièrement : l'objet et le texte. L'aperçu montre la page telle qu'elle sera imprimée, et le PDF reprend votre dernière version enregistrée."],
  ["Dans quelle langue est écrite la lettre ?", "Dans la langue de l'offre : en français pour une offre en français, en anglais pour une offre en anglais."],
  ["Que deviennent mes données ?", `Vos CV et vos lettres ne sont visibles que par vous. Sans compte, ils sont supprimés après ${config.cleanup.guestInactiveDays} jours sans visite ; avec un compte, vous les supprimez quand vous voulez.`],
];

const LETTER_CTA: [string, string] = ["Écrire ma lettre maintenant — gratuit", "Commencer avec mon CV"];
const LETTER_CRUMBS = [{ name: "Lettre de motivation", path: "/lettre-de-motivation" }];

const createFaq = (): Faq[] => [
  ["Est-ce gratuit ?", "Oui, et sans inscription pour commencer : votre CV est enregistré dans votre espace. Créez un compte pour le garder sur tous vos appareils."],
  ["Je n'ai pas d'expérience professionnelle", "Les stages, jobs d'été, missions de bénévolat, associations étudiantes et projets d'études comptent : décrivez-les avec vos mots, l'assistant les met en forme. Vous pouvez aussi passer l'étape."],
  ["L'IA écrit-elle mon CV à ma place ?", "Non : vous écrivez ce que vous avez fait, et l'IA peut le reformuler en phrases de CV ou rédiger votre profil à partir de ce que vous avez saisi. Elle n'ajoute ni tâche, ni outil, ni chiffre que vous n'avez pas écrit."],
  ["Et ensuite ?", "Votre CV prêt, adaptez-le à chaque offre qui vous intéresse, écrivez votre lettre de motivation, et téléchargez-les en PDF."],
  ["Que deviennent mes données ?", `Votre CV n'est visible que par vous. Sans compte, il est supprimé après ${config.cleanup.guestInactiveDays} jours sans visite ; avec un compte, vous le supprimez quand vous voulez.`],
];

const TOOLS: Tool[] = [
  {
    start: TOOL_START,
    cta: ["Adapter mon CV maintenant — gratuit", "Commencer avec mon CV"],
    application: "Adapter son CV à une offre",
    crumbs: [],
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
    start: TOOL_START,
    cta: ["Adapter mon CV maintenant — gratuit", "Commencer avec mon CV"],
    application: "Adapter son CV à une offre",
    crumbs: [{ name: "Adapter son CV", path: "/adapter-son-cv" }],
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
    start: TOOL_START,
    cta: ["Adapter mon CV maintenant — gratuit", "Commencer avec mon CV"],
    application: "Adapter son CV à une offre",
    crumbs: [{ name: "Adapter son CV", path: "/adapter-son-cv" }],
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
  {
    path: "/lettre-de-motivation",
    start: LETTER_START,
    cta: LETTER_CTA,
    application: "Lettre de motivation adaptée à l'offre",
    crumbs: [],
    title: "Lettre de motivation adaptée à l'offre, gratuite",
    heading: "Une lettre de motivation adaptée à chaque offre",
    description: "Votre lettre de motivation écrite pour l'offre, à partir de votre CV, en quelques secondes : sans rien inventer, à modifier puis télécharger en PDF. Gratuit, sans inscription.",
    crumb: "Lettre de motivation",
    intro: [
      "Une lettre de motivation générique se repère tout de suite. Les recruteurs qui la lisent cherchent pourquoi vous, pourquoi ce poste, et ce que vous apporterez — avec des éléments précis, dans les mots de leur offre.",
      "MonPoste écrit votre lettre pour chaque offre à partir de votre CV : vous n'avez plus qu'à la relire et l'ajuster.",
    ],
    sections: [
      { title: "Ce qu'une bonne lettre de motivation contient", items: ["Le poste visé et ce qui vous attire dans l'offre, à partir de ce qu'elle dit.", "Ce que vous apportez : deux ou trois éléments concrets de votre parcours, reliés aux besoins de l'offre.", "Ce que vous voulez construire avec l'entreprise, et votre disponibilité pour un entretien.", "Une page, un ton sobre, sans faute — et l'objet de la lettre qui reprend l'intitulé du poste."] },
      letterSteps,
      letterRules,
    ],
    faq: [],
    see: [
      { href: "/lettre-de-motivation/alternance", label: "Lettre de motivation pour une alternance" },
      { href: "/lettre-de-motivation/stage", label: "Lettre de motivation pour un stage" },
      { href: "/adapter-son-cv", label: "Adapter son CV à une offre" },
      { href: "/emplois", label: "Trouver une offre d'emploi" },
    ],
  },
  {
    path: "/lettre-de-motivation/alternance",
    start: LETTER_START,
    cta: LETTER_CTA,
    application: "Lettre de motivation adaptée à l'offre",
    crumbs: LETTER_CRUMBS,
    title: "Lettre de motivation pour une alternance, adaptée à l'offre",
    heading: "Lettre de motivation pour une alternance",
    description: "Votre lettre de motivation d'alternance écrite pour l'offre, à partir de votre CV : formation, école, rythme et motivation, sans rien inventer. Gratuit, sans inscription.",
    crumb: "Pour une alternance",
    intro: [
      "Pour une alternance, l'entreprise s'engage pour toute la durée de votre formation : votre lettre doit dire clairement le diplôme préparé, l'école, le rythme et la date de début, et montrer que vous avez compris le poste.",
      "Avec peu d'expérience, ce sont vos études, vos projets et vos premiers emplois qui comptent : MonPoste les relie aux missions de l'offre, à partir de votre CV.",
    ],
    sections: [
      { title: "Ce qu'une lettre d'alternance doit dire", items: ["La formation préparée, l'école, le rythme d'alternance et la date de début possible.", "Pourquoi ce métier et cette entreprise, à partir de ce que dit l'offre.", "Ce que vous savez déjà faire : projets d'études, stages, jobs, en lien avec les missions.", "Ce que vous voulez apprendre pendant le contrat."] },
      letterSteps,
      letterRules,
    ],
    faq: [["Je n'ai pas encore d'école, ça marche ?", "Oui : la lettre parle de la formation que vous visez si votre CV la mentionne. Pensez à préciser ensuite l'école et le rythme dès que vous les connaissez."]],
    see: [
      { href: "/alternance", label: "Les offres en alternance" },
      { href: "/adapter-son-cv/alternance", label: "Adapter son CV pour une alternance" },
      { href: "/lettre-de-motivation", label: "Lettre de motivation adaptée à l'offre" },
    ],
  },
  {
    path: "/lettre-de-motivation/stage",
    start: LETTER_START,
    cta: LETTER_CTA,
    application: "Lettre de motivation adaptée à l'offre",
    crumbs: LETTER_CRUMBS,
    title: "Lettre de motivation pour un stage, adaptée à l'offre",
    heading: "Lettre de motivation pour un stage",
    description: "Votre lettre de motivation de stage écrite pour l'offre, à partir de votre CV : formation, dates, durée et missions, sans rien inventer. Gratuit, sans inscription.",
    crumb: "Pour un stage",
    intro: [
      "Pour un stage, la lettre fait souvent la différence entre des CV d'étudiants très proches : elle dit ce que vous étudiez, les dates et la durée du stage, et ce que vous pouvez apporter aux missions décrites.",
      "MonPoste écrit votre lettre de stage pour chaque offre à partir de votre CV, en quelques secondes.",
    ],
    sections: [
      { title: "Ce qu'une lettre de stage doit dire", items: ["Votre formation, votre école, votre année d'études.", "Les dates et la durée du stage, et la convention de stage si votre école la fournit.", "Ce qui vous attire dans les missions de l'offre, et ce que vous en connaissez déjà par vos cours ou vos projets.", "Ce que vous voulez apprendre pendant le stage."] },
      letterSteps,
      letterRules,
    ],
    faq: [["Puis-je écrire une lettre pour plusieurs stages ?", "Oui : chaque offre a sa propre lettre, que vous retrouvez avec vos CV générés."]],
    see: [
      { href: "/stage", label: "Les offres de stage" },
      { href: "/adapter-son-cv/stage", label: "Adapter son CV pour un stage" },
      { href: "/lettre-de-motivation", label: "Lettre de motivation adaptée à l'offre" },
    ],
  },
  {
    path: "/creer-son-cv",
    start: CREATE_START,
    cta: ["Créer mon CV maintenant — gratuit", "Commencer mon CV"],
    application: "Créer son CV en ligne",
    crumbs: [],
    title: "Créer son CV en ligne, gratuitement et étape par étape",
    heading: "Créer son CV en ligne, étape par étape",
    description: "Créez votre CV en quelques minutes, sans partir d'une page blanche : vos expériences avec vos mots, les compétences que les employeurs demandent, une reformulation par l'IA. Gratuit, sans inscription.",
    crumb: "Créer son CV",
    intro: [
      "Le plus difficile, c'est souvent la page blanche : quoi mettre, dans quel ordre, avec quels mots. Surtout pour un premier CV, quand on pense ne rien avoir à raconter.",
      "L'assistant de MonPoste vous pose les bonnes questions, une étape à la fois, et vous aide à formuler — sans jamais rien inventer.",
    ],
    sections: [
      {
        ordered: true,
        title: "Comment ça marche",
        items: [
          "Vous : votre nom, le poste que vous recherchez, vos coordonnées.",
          "Vos expériences : emplois, stages, jobs d'été, bénévolat — ce que vous y faisiez, avec vos mots. Un bouton les reformule en phrases de CV.",
          "Votre formation : le diplôme en cours ou obtenu, l'établissement, les dates.",
          "Vos compétences et langues, avec celles que les employeurs demandent pour le poste visé.",
          "Votre profil, en deux ou trois phrases, que l'IA peut rédiger à partir de ce que vous avez saisi.",
        ],
      },
      {
        title: "Les compétences que les employeurs demandent vraiment",
        paragraphs: ["Pour le poste que vous visez, l'assistant vous propose les compétences qui reviennent dans les offres d'emploi actuelles des employeurs qui recrutent ce métier — pas une liste générique. Vous ajoutez celles que vous avez, d'un clic."],
      },
      {
        title: "Et ensuite",
        paragraphs: ["Votre CV est enregistré et modifiable à tout moment. Adaptez-le à chaque offre qui vous intéresse, écrivez votre lettre de motivation, et téléchargez-les en PDF, avec huit modèles au choix."],
      },
    ],
    faq: [],
    see: [
      { href: "/adapter-son-cv", label: "Adapter son CV à une offre" },
      { href: "/lettre-de-motivation", label: "Lettre de motivation adaptée à l'offre" },
      { href: "/alternance", label: "Les offres en alternance" },
      { href: "/stage", label: "Les offres de stage" },
    ],
  },
];

export const toolPaths = () => TOOLS.map((tool) => tool.path);

const cta = (start: string, label: string) => `<p><a class="landing-cta" href="${start}">${escapeHtml(label)}</a></p>`;

export function toolPage(path: string): LandingPage | null {
  const tool = TOOLS.find((item) => item.path === path);
  if (!tool) return null;
  const faq = [...tool.faq, ...(tool.start === LETTER_START ? letterFaq(config.limits) : tool.start === CREATE_START ? createFaq() : resumeFaq(config.limits))];
  const trail = breadcrumbs([{ name: config.seo.siteName, path: "/" }, ...tool.crumbs, { name: tool.crumb, path: tool.path }]);
  const body = `${trail.html}
<h1>${escapeHtml(tool.heading)}</h1>
${tool.intro.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
${cta(tool.start, tool.cta[0])}
${tool.sections
  .map((section) => `<h2>${escapeHtml(section.title)}</h2>${(section.paragraphs ?? []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}${section.items ? `<${section.ordered ? "ol" : "ul"} class="landing-list">${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${section.ordered ? "ol" : "ul"}>` : ""}`)
  .join("\n")}
<h2>Questions fréquentes</h2>
${faq.map(([question, answer]) => `<h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p>`).join("\n")}
${cta(tool.start, tool.cta[1])}
<h2>Voir aussi</h2><ul class="landing-links">${tool.see.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`).join("")}</ul>`;
  const application = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${config.seo.siteName} — ${tool.application}`,
    url: `${config.webBaseUrl}${tool.path}`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "fr",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  };
  return { status: 200, html: landingDocument({ title: tool.title, description: tool.description, path: tool.path, body, data: [trail.data, application] }) };
}
