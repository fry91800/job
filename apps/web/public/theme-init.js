// Theme applied before the first paint (no flash of the wrong theme). Same rule as
// src/theme/theme.ts: the saved choice, else the system's. A file rather than an inline
// script, so the Content-Security-Policy can forbid inline scripts (deploy/Caddyfile).
(function () {
  var choice = "system";
  try {
    choice = localStorage.getItem("job.theme") || "system";
  } catch (e) {}
  var dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  // JavaScript runs: the app will replace the offer the server sent (styles.css, .seo-offer).
  document.documentElement.classList.add("js");
})();
