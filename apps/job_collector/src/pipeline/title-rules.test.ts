import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { itOccupationCodes } from "./title-rules";

// Real titles from collected offers.

describe("IT title rules", () => {
  test("IT titles, French and English, get their ROME code", () => {
    const cases: [string, string][] = [
      ["Développeur Java / AWS Senior F/H", "M1805"],
      ["Junior Full Stack Developer (Node.js / React)", "M1805"],
      ["Développeur Fullstack Expert", "M1805"],
      ["Ingénieur(e) en développement C++ H/F", "M1805"],
      ["Tech Lead Java/Angular & IA - Air Traffic Management (ATM) - Toulouse", "M1805"],
      ["Staff Data Engineer", "M1811"],
      ["Ingénieur/e Data – Services Publics – Bordeaux", "M1811"],
      ["Data Scientist Internship (November, 6 months)", "M1889"],
      ["Site Reliability Engineer, AI Platform", "M1827"],
      ["Ingénieur(e) Cloud Azure - Digital Platform Services - Rennes", "M1860"],
      ["Analyste Gestion des Vulnérabilités - Cybersécurité - Aix en Provence", "M1856"],
      ["Product Owner Integration - M/F/X", "M1864"],
      ["Technicien support applicatif N3 H/F", "M1874"],
      ["Consultant Fonctionnel Microsoft Dynamics (D365) SENIOR - Module Production - ERP (H/F)", "M1806"],
      ["Chef de projet AMOA SI [Luxe-Retail] (H/F)", "M1881"],
      ["Nucléaire - Ingénieur V&V Logiciels embarqué H/F", "M1892"],
      ["Lead QA Automation (all genders)", "M1815"],
      ["Lead Game Developer - Woodturning", "M1831"],
      ["Webmaster H/F", "M1834"],
    ];
    for (const [title, code] of cases) assert.ok(itOccupationCodes(title).includes(code), `${title} → ${itOccupationCodes(title).join(",") || "nothing"}`);
  });

  test("look-alike titles outside IT get nothing", () => {
    for (const title of [
      "Business Developer Issy",
      "Community Developer - Unannounced Projects (F/H/NB)",
      "Responsable Développement RH Normandie (F/H)",
      "Chef de projet mécanique H/F",
      "Chef de projet industriel H/F",
      "Spécialiste Support Pilotage et Comptabilité (Télétravail complet possible - Valence)",
      "Ingénieur de production H/F",
      "Ingénieur ou technicien confirmé Vulnérabilité du Bati F/H",
      "Programmeur commande numérique H/F",
      "QA Specialist - Pharmaceutical Quality",
      "Ingénieur développement produit cosmétique",
      "Auxiliaire de vie H/F",
    ]) {
      assert.deepEqual(itOccupationCodes(title), [], title);
    }
  });
});
