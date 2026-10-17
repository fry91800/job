import { escapeHtml } from "@job/shared/src/markdown";
import { jobAlertCreateSchema, jobAlertUpdateSchema, type JobAlertListResponse } from "@job/shared";
import { Router, type Response } from "express";
import { requireRegistered, requireSession } from "../auth/session";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { createAlert, deleteAlert, listAlerts, unsubscribe, updateAlert } from "./alerts";

// Job alerts (GROWTH.md phase 2).
export const alertsRouter = Router();

// GET /api/alerts
alertsRouter.get("/", requireSession, async (req, res) => {
  res.json({ results: await listAlerts(req.user!.id) } satisfies JobAlertListResponse);
});

// POST /api/alerts — an account is needed (the alerts go to its address). The same search
// twice gives the existing alert (200).
alertsRouter.post("/", requireRegistered, async (req, res) => {
  const { alert, created } = await createAlert(req.user!.id, jobAlertCreateSchema.parse(req.body));
  res.status(created ? 201 : 200).json(alert);
});

// PATCH /api/alerts/:id — frequency, pause/resume.
alertsRouter.patch("/:id", requireRegistered, async (req, res) => {
  res.json(await updateAlert(req.user!.id, String(req.params.id), jobAlertUpdateSchema.parse(req.body)));
});

alertsRouter.delete("/:id", requireRegistered, async (req, res) => {
  await deleteAlert(req.user!.id, String(req.params.id));
  res.status(204).end();
});

// The email's unsubscribe link. GET shows a button (mail scanners open links: a GET must
// not change anything); POST pauses the alert, also as the one-click unsubscribe of the
// List-Unsubscribe-Post header (RFC 8058), which mail apps send without a session.
const TEXTS = {
  fr: { title: "Alerte e-mail", confirm: "Ne plus recevoir l'alerte « {label} » ?", button: "Désactiver l'alerte", done: "L'alerte « {label} » est désactivée. Vous pouvez la réactiver ou la supprimer dans les Paramètres de MonPoste.", unknown: "Ce lien n'est plus valable : l'alerte a été supprimée.", back: "Retour à MonPoste" },
  en: { title: "Email alert", confirm: "Stop receiving the alert \"{label}\"?", button: "Turn off the alert", done: "The alert \"{label}\" is turned off. You can turn it back on or delete it in MonPoste's Settings.", unknown: "This link is no longer valid: the alert was deleted.", back: "Back to MonPoste" },
};

function page(res: Response, status: number, language: string, body: string) {
  const t = TEXTS[language === "en" ? "en" : "fr"];
  res
    .status(status)
    .set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
    .set("Cache-Control", "no-store")
    .type("html")
    .send(`<!doctype html><html lang="${language === "en" ? "en" : "fr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${t.title} · MonPoste</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#222;line-height:1.5}button{font:inherit;padding:8px 16px;border:0;border-radius:6px;background:#4f46e5;color:#fff;cursor:pointer}a{color:#4f46e5}</style></head>
<body>${body}<p><a href="${escapeHtml(config.webBaseUrl)}/">${t.back}</a></p></body></html>`);
}

alertsRouter.get("/unsubscribe/:token", async (req, res) => {
  const alert = await prisma.jobAlert.findUnique({ where: { unsubscribeToken: String(req.params.token) }, include: { user: { select: { uiLanguage: true } } } });
  const language = alert?.user.uiLanguage ?? "fr";
  const t = TEXTS[language === "en" ? "en" : "fr"];
  if (!alert) return page(res, 404, language, `<p>${t.unknown}</p>`);
  page(res, 200, language, `<p>${escapeHtml(t.confirm.replace("{label}", alert.label))}</p><form method="post"><button type="submit">${t.button}</button></form>`);
});

alertsRouter.post("/unsubscribe/:token", async (req, res) => {
  const result = await unsubscribe(String(req.params.token));
  const language = result?.language ?? "fr";
  const t = TEXTS[language === "en" ? "en" : "fr"];
  if (!result) return page(res, 404, language, `<p>${t.unknown}</p>`);
  page(res, 200, language, `<p>${escapeHtml(t.done.replace("{label}", result.label))}</p>`);
});
