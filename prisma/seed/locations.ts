import type { LocationType } from "@prisma/client";

// Real places with real codes and coordinates, so area and radius search (DATABASE.md
// "locations") can be tested. Every place stores all its parent codes.
export type SeedLocation = {
  key: string;
  type: LocationType;
  name: string;
  countryCode: string;
  regionCode: string | null;
  regionName: string | null;
  countyCode: string | null;
  countyName: string | null;
  latitude: number | null;
  longitude: number | null;
};

const regions = {
  "FR-IDF": "Île-de-France",
  "FR-ARA": "Auvergne-Rhône-Alpes",
  "FR-PAC": "Provence-Alpes-Côte d'Azur",
  "FR-OCC": "Occitanie",
  "FR-NAQ": "Nouvelle-Aquitaine",
  "FR-PDL": "Pays de la Loire",
  "FR-HDF": "Hauts-de-France",
  "FR-BRE": "Bretagne",
  "FR-GES": "Grand Est",
  "BE-BRU": "Région de Bruxelles-Capitale",
} as const;

type RegionCode = keyof typeof regions;

const counties: Record<string, { name: string; region: RegionCode }> = {
  "75": { name: "Paris", region: "FR-IDF" },
  "78": { name: "Yvelines", region: "FR-IDF" },
  "91": { name: "Essonne", region: "FR-IDF" },
  "92": { name: "Hauts-de-Seine", region: "FR-IDF" },
  "93": { name: "Seine-Saint-Denis", region: "FR-IDF" },
  "94": { name: "Val-de-Marne", region: "FR-IDF" },
  "69": { name: "Rhône", region: "FR-ARA" },
  "38": { name: "Isère", region: "FR-ARA" },
  "13": { name: "Bouches-du-Rhône", region: "FR-PAC" },
  "06": { name: "Alpes-Maritimes", region: "FR-PAC" },
  "31": { name: "Haute-Garonne", region: "FR-OCC" },
  "34": { name: "Hérault", region: "FR-OCC" },
  "33": { name: "Gironde", region: "FR-NAQ" },
  "44": { name: "Loire-Atlantique", region: "FR-PDL" },
  "59": { name: "Nord", region: "FR-HDF" },
  "35": { name: "Ille-et-Vilaine", region: "FR-BRE" },
  "67": { name: "Bas-Rhin", region: "FR-GES" },
};

// [key, name, county code, latitude, longitude]
const frenchCities: [string, string, string, number, number][] = [
  ["paris", "Paris", "75", 48.8566, 2.3522],
  ["versailles", "Versailles", "78", 48.8049, 2.1204],
  ["brunoy", "Brunoy", "91", 48.6979, 2.5044],
  ["evry", "Évry-Courcouronnes", "91", 48.629, 2.441],
  ["massy", "Massy", "91", 48.7309, 2.2713],
  ["palaiseau", "Palaiseau", "91", 48.7145, 2.2457],
  ["boulogne", "Boulogne-Billancourt", "92", 48.8397, 2.2399],
  ["nanterre", "Nanterre", "92", 48.8924, 2.2071],
  ["courbevoie", "Courbevoie", "92", 48.8973, 2.2522],
  ["saint-denis", "Saint-Denis", "93", 48.9362, 2.3574],
  ["montreuil", "Montreuil", "93", 48.8638, 2.4485],
  ["creteil", "Créteil", "94", 48.7904, 2.4556],
  ["lyon", "Lyon", "69", 45.764, 4.8357],
  ["villeurbanne", "Villeurbanne", "69", 45.7719, 4.8902],
  ["grenoble", "Grenoble", "38", 45.1885, 5.7245],
  ["marseille", "Marseille", "13", 43.2965, 5.3698],
  ["aix", "Aix-en-Provence", "13", 43.5297, 5.4474],
  ["nice", "Nice", "06", 43.7102, 7.262],
  ["valbonne", "Valbonne", "06", 43.6413, 7.0089],
  ["toulouse", "Toulouse", "31", 43.6047, 1.4442],
  ["montpellier", "Montpellier", "34", 43.6108, 3.8767],
  ["bordeaux", "Bordeaux", "33", 44.8378, -0.5792],
  ["nantes", "Nantes", "44", 47.2184, -1.5536],
  ["lille", "Lille", "59", 50.6292, 3.0573],
  ["rennes", "Rennes", "35", 48.1173, -1.6778],
  ["strasbourg", "Strasbourg", "67", 48.5734, 7.7521],
];

function buildLocations(): SeedLocation[] {
  const list: SeedLocation[] = [
    { key: "country:FR", type: "country", name: "France", countryCode: "FR", regionCode: null, regionName: null, countyCode: null, countyName: null, latitude: 46.6034, longitude: 1.8883 },
    { key: "country:BE", type: "country", name: "Belgique", countryCode: "BE", regionCode: null, regionName: null, countyCode: null, countyName: null, latitude: 50.5039, longitude: 4.4699 },
  ];

  for (const [code, name] of Object.entries(regions)) {
    list.push({ key: `region:${code}`, type: "region", name, countryCode: code.slice(0, 2), regionCode: code, regionName: name, countyCode: null, countyName: null, latitude: null, longitude: null });
  }

  for (const [code, county] of Object.entries(counties)) {
    list.push({ key: `county:${code}`, type: "county", name: county.name, countryCode: "FR", regionCode: county.region, regionName: regions[county.region], countyCode: code, countyName: county.name, latitude: null, longitude: null });
  }

  for (const [key, name, countyCode, latitude, longitude] of frenchCities) {
    const county = counties[countyCode];
    list.push({ key: `city:${key}`, type: "city", name, countryCode: "FR", regionCode: county.region, regionName: regions[county.region], countyCode, countyName: county.name, latitude, longitude });
  }

  // Brussels has no county level: county codes stay NULL.
  list.push({ key: "city:bruxelles", type: "city", name: "Bruxelles", countryCode: "BE", regionCode: "BE-BRU", regionName: regions["BE-BRU"], countyCode: null, countyName: null, latitude: 50.8503, longitude: 4.3517 });

  return list;
}

export const locations = buildLocations();

// Weighted pool for generated offers: most offers in Île-de-France, around Brunoy and Paris,
// so a city + radius search returns several pages.
export const offerCityWeights: [string, number][] = [
  ["city:paris", 30], ["city:boulogne", 6], ["city:courbevoie", 6], ["city:nanterre", 4],
  ["city:saint-denis", 3], ["city:montreuil", 3], ["city:creteil", 2], ["city:versailles", 3],
  ["city:brunoy", 3], ["city:evry", 4], ["city:massy", 4], ["city:palaiseau", 3],
  ["city:lyon", 10], ["city:villeurbanne", 3], ["city:grenoble", 3],
  ["city:marseille", 4], ["city:aix", 3], ["city:nice", 2], ["city:valbonne", 3],
  ["city:toulouse", 7], ["city:montpellier", 3], ["city:bordeaux", 6], ["city:nantes", 6],
  ["city:lille", 5], ["city:rennes", 4], ["city:strasbourg", 3],
];
