import type { OfferDraft } from "@job/shared";

// PLACEHOLDER for offer extraction (FEATURE O5). The real version fetches the URL
// server-side (with SSRF protection), converts the page to simplified Markdown and asks
// the AI for the fields; for pasted text, the AI extracts the fields from the text.
// Until then:
// * URL: returns the same sample offer for any page, with the URL filled in;
// * text: first non-empty line = title, the rest = description (line breaks kept).
export async function extractOfferDraft(input: { url: string } | { text: string }): Promise<OfferDraft> {
  if ("url" in input) {
    return {
      title: "Développeur TypeScript (offre d'exemple)",
      companyName: "Entreprise Exemple",
      description: [
        "Offre d'exemple : l'extraction automatique n'est pas encore disponible, vérifiez et corrigez les champs.",
        "",
        "## Vos missions",
        "",
        "- Développer de nouvelles fonctionnalités en TypeScript et Node.js",
        "- Participer aux revues de code",
      ].join("\n"),
      language: "fr",
      url: input.url,
      locationId: null,
      remoteType: "hybrid",
      contractType: "permanent",
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
    };
  }

  const lines = input.text.replace(/\r\n?/g, "\n").split("\n");
  const titleIndex = lines.findIndex((line) => line.trim() !== "");
  const title = lines[titleIndex].trim().slice(0, 300);
  const description = lines.slice(titleIndex + 1).join("\n").trim() || title;
  return {
    title,
    companyName: null,
    description,
    language: null,
    url: null,
    locationId: null,
    remoteType: null,
    contractType: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
  };
}
