// Settings a production API must have (DEPLOYMENT.md): it refuses to start without them
// rather than run with development defaults (MailHog, localhost links, no proxy…).

export function productionProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  const need = (name: string, why: string) => {
    if (!env[name]?.trim()) problems.push(`${name} is missing (${why})`);
  };
  need("DATABASE_URL", "database");
  need("WEB_BASE_URL", "links in emails");
  need("WEB_ORIGINS", "allowed web origins");
  need("TRUST_PROXY", "visitor addresses behind the reverse proxy, for rate limits");
  need("SMTP_HOST", "email provider");
  need("MAIL_FROM", "sender of the emails");
  need("STORAGE_LOCAL_DIR", "uploaded files, on a persistent volume");
  if ((env.AI_PROVIDER ?? "gemini") === "gemini") need("GEMINI_API_KEY", "AI features");
  if (env.AI_PROVIDER === "fake") problems.push("AI_PROVIDER=fake is for tests only");
  if (env.WEB_BASE_URL && !env.WEB_BASE_URL.startsWith("https://")) problems.push("WEB_BASE_URL must be an https:// address");
  for (const origin of (env.WEB_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
    if (!origin.startsWith("https://")) problems.push(`WEB_ORIGINS: ${origin} must be https://`);
  }
  if (env.SMTP_HOST && /^(localhost|127\.0\.0\.1|mailhog)$/i.test(env.SMTP_HOST)) problems.push("SMTP_HOST points to a development mail catcher");
  if (env.MAIL_TRANSPORT === "memory") problems.push("MAIL_TRANSPORT=memory is for tests only");
  return problems;
}
