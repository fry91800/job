// Email texts, in the user's interface language (FEATURE L1). Plain text plus a minimal
// HTML version; every value inserted in the HTML is escaped.

type Language = "fr" | "en";

// Signs every email (the sender's name is set by MAIL_FROM).
const BRAND = "MonPoste";

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(paragraphs: string[], link: { url: string; label: string }): string {
  return `<!doctype html><html><body style="font-family: Arial, sans-serif; font-size: 15px; color: #222; max-width: 560px">
${paragraphs.map((text) => `<p>${esc(text)}</p>`).join("\n")}
<p><a href="${esc(link.url)}" style="display: inline-block; padding: 10px 16px; background: #1f3a5f; color: #fff; text-decoration: none; border-radius: 4px">${esc(link.label)}</a></p>
<p style="color: #777; font-size: 13px">${esc(link.url)}</p>
<p style="color: #777; font-size: 13px">${BRAND}</p>
</body></html>`;
}

export function passwordResetEmail(language: Language, url: string) {
  const t = {
    fr: {
      subject: "Réinitialisation de votre mot de passe",
      lines: ["Vous avez demandé à réinitialiser votre mot de passe.", "Ce lien est valable 1 heure et ne peut servir qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail."],
      button: "Choisir un nouveau mot de passe",
    },
    en: {
      subject: "Reset your password",
      lines: ["You asked to reset your password.", "This link is valid for 1 hour and can only be used once. If you didn't ask for it, ignore this email."],
      button: "Choose a new password",
    },
  }[language];
  return { subject: t.subject, text: `${t.lines.join("\n\n")}\n\n${url}\n\n${BRAND}\n`, html: layout(t.lines, { url, label: t.button }) };
}

export function emailVerificationEmail(language: Language, url: string) {
  const t = {
    fr: {
      subject: "Confirmez votre adresse e-mail",
      lines: ["Bienvenue sur MonPoste ! Confirmez votre adresse e-mail en cliquant sur le lien ci-dessous.", "Ce lien est valable 48 heures. Votre compte est utilisable dès maintenant."],
      button: "Confirmer mon adresse",
    },
    en: {
      subject: "Confirm your email address",
      lines: ["Welcome to MonPoste! Confirm your email address with the link below.", "This link is valid for 48 hours. Your account can be used right away."],
      button: "Confirm my address",
    },
  }[language];
  return { subject: t.subject, text: `${t.lines.join("\n\n")}\n\n${url}\n\n${BRAND}\n`, html: layout(t.lines, { url, label: t.button }) };
}

// A message from the feedback form (GROWTH.md), to the operator: always in French.
export function feedbackEmail(feedback: { message: string; email: string | null; page: string | null; sender: string; language: string }) {
  const firstLine = feedback.message.split("\n")[0].slice(0, 60);
  const details = [`De : ${feedback.email ?? "(pas d'adresse)"} · ${feedback.sender} · langue ${feedback.language}`, `Page : ${feedback.page ?? "?"}`];
  return {
    subject: `[Avis] ${firstLine}`,
    text: `${feedback.message}\n\n--\n${details.join("\n")}\n`,
    html: `<!doctype html><html><body style="font-family: Arial, sans-serif; font-size: 15px; color: #222; max-width: 640px">
<p style="white-space: pre-wrap">${esc(feedback.message)}</p>
<hr style="border: 0; border-top: 1px solid #ddd">
${details.map((line) => `<p style="color: #777; font-size: 13px; margin: 4px 0">${esc(line)}</p>`).join("\n")}
</body></html>`,
  };
}

// A job alert's new offers (GROWTH.md phase 2), in the account's language.
export type AlertOffer = { url: string; title: string; facts: string };

export function jobAlertEmail(language: Language, alert: { label: string; offers: AlertOffer[]; total: number; searchUrl: string; unsubscribeUrl: string; settingsUrl: string }) {
  const t = {
    fr: {
      subject: alert.total > 1 ? `${alert.total} nouvelles offres : ${alert.label}` : `Nouvelle offre : ${alert.label}`,
      intro: alert.total > 1 ? `${alert.total} nouvelles offres pour votre alerte « ${alert.label} » :` : `Une nouvelle offre pour votre alerte « ${alert.label} » :`,
      all: alert.total > alert.offers.length ? `Voir les ${alert.total} offres` : "Voir dans MonPoste",
      footer: "Vous recevez cet e-mail parce que vous avez créé cette alerte sur MonPoste.",
      manage: "Gérer mes alertes",
      stop: "Ne plus recevoir cette alerte",
    },
    en: {
      subject: alert.total > 1 ? `${alert.total} new offers: ${alert.label}` : `New offer: ${alert.label}`,
      intro: alert.total > 1 ? `${alert.total} new offers for your alert "${alert.label}":` : `A new offer for your alert "${alert.label}":`,
      all: alert.total > alert.offers.length ? `See all ${alert.total} offers` : "See in MonPoste",
      footer: "You receive this email because you created this alert on MonPoste.",
      manage: "Manage my alerts",
      stop: "Stop this alert",
    },
  }[language];
  const text = [
    t.intro,
    "",
    ...alert.offers.flatMap((offer) => [`- ${offer.title}`, `  ${offer.facts}`, `  ${offer.url}`]),
    "",
    `${t.all} : ${alert.searchUrl}`,
    "",
    "--",
    t.footer,
    `${t.manage} : ${alert.settingsUrl}`,
    `${t.stop} : ${alert.unsubscribeUrl}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family: Arial, sans-serif; font-size: 15px; color: #222; max-width: 600px">
<p>${esc(t.intro)}</p>
${alert.offers
  .map((offer) => `<p style="margin: 14px 0"><a href="${esc(offer.url)}" style="color: #1f3a5f; font-weight: bold; text-decoration: none">${esc(offer.title)}</a><br><span style="color: #555; font-size: 14px">${esc(offer.facts)}</span></p>`)
  .join("\n")}
<p><a href="${esc(alert.searchUrl)}" style="display: inline-block; padding: 10px 16px; background: #1f3a5f; color: #fff; text-decoration: none; border-radius: 4px">${esc(t.all)}</a></p>
<p style="color: #777; font-size: 12px; margin-top: 28px">${esc(t.footer)}<br><a href="${esc(alert.settingsUrl)}" style="color: #777">${esc(t.manage)}</a> · <a href="${esc(alert.unsubscribeUrl)}" style="color: #777">${esc(t.stop)}</a></p>
<p style="color: #777; font-size: 12px">${BRAND}</p>
</body></html>`;
  return { subject: t.subject, text: `${text}\n`, html };
}
