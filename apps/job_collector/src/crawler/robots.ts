// robots.txt (RFC 9309): the rules of the group naming our agent, else of "*"; the
// longest matching rule wins, "allow" on a tie; "*" and "$" in patterns. Crawl-delay
// (not in the RFC, widely used) and Sitemap lines are read too.

export type Robots = { allows(path: string): boolean; crawlDelayMs: number | null; sitemaps: string[] };

type Rule = { allow: boolean; pattern: string; regex: RegExp };

// "/jobs/*.pdf$": "*" is any text, a final "$" anchors the end; the rest is literal.
function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function parseRobots(text: string, agent: string): Robots {
  type Group = { agents: string[]; rules: Rule[]; delay: number | null };
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !current) groups.push((current = { agents: [], rules: [], delay: null }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
    } else if (current && (key === "allow" || key === "disallow")) {
      // An empty "Disallow:" allows everything: no rule.
      if (value) current.rules.push({ allow: key === "allow", pattern: value, regex: toRegex(value) });
    } else if (current && key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.delay = seconds * 1000;
    }
  }

  const name = agent.toLowerCase();
  const ours = groups.filter((group) => group.agents.some((value) => value !== "*" && name.startsWith(value.split("/")[0])));
  const chosen = ours.length ? ours : groups.filter((group) => group.agents.includes("*"));
  const rules = chosen.flatMap((group) => group.rules);
  const delays = chosen.map((group) => group.delay).filter((delay): delay is number => delay !== null);

  return {
    allows(path: string) {
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        const length = rule.pattern.replace(/[*$]/g, "").length;
        const bestLength = best ? best.pattern.replace(/[*$]/g, "").length : -1;
        if (length > bestLength || (length === bestLength && rule.allow)) best = rule;
      }
      return best ? best.allow : true;
    },
    crawlDelayMs: delays.length ? Math.max(...delays) : null,
    sitemaps,
  };
}

// robots.txt missing (4xx): everything allowed. Unreachable or 5xx: nothing allowed for now.
export const ALLOW_ALL: Robots = { allows: () => true, crawlDelayMs: null, sitemaps: [] };
export const DISALLOW_ALL: Robots = { allows: () => false, crawlDelayMs: null, sitemaps: [] };
