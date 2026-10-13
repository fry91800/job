import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config";

// Sends emails through SMTP (MailHog in development). With the "memory" transport
// (tests), messages are kept in `sentMails` instead.

export type Mail = { to: string; subject: string; text: string; html: string };

export const sentMails: Mail[] = [];

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.smtpHost,
      port: config.mail.smtpPort,
      secure: config.mail.smtpSecure,
      auth: config.mail.smtpUser ? { user: config.mail.smtpUser, pass: config.mail.smtpPassword } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (config.mail.transport === "memory") {
    sentMails.push(mail);
    return;
  }
  await getTransporter().sendMail({ from: config.mail.from, ...mail });
}

// For flows that must answer the same way whether or not an email is sent (no account
// enumeration, A4): the email is sent in the background and failures are only logged.
export function sendMailInBackground(mail: Mail): void {
  sendMail(mail).catch((error) => console.error("email not sent:", error instanceof Error ? error.message : error));
}
