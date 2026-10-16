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
