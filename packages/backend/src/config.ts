import "dotenv/config";

// Configuration of the server code shared by the API and the job collector. Objects are
// shared by reference: the API's config exposes them, and tests may change them.
export const backendConfig = {
  // Geoapify place autocomplete (D47). Without a key, only the `locations` table is used.
  geoapify: {
    apiKey: process.env.GEOAPIFY_API_KEY,
    baseUrl: process.env.GEOAPIFY_BASE_URL ?? "https://api.geoapify.com",
    countries: (process.env.GEOAPIFY_COUNTRIES ?? "fr").split(",").map((code) => code.trim().toLowerCase()),
    language: "fr",
    timeoutMs: 3000,
    cacheTtlMs: 24 * 3600 * 1000,
  },
};
