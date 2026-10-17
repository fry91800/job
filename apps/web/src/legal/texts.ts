import { OPERATOR as O } from "./operator";

// Privacy policy and terms of use, in simplified Markdown ("## " headings, "- " lists,
// **bold**). Drafts to have reviewed before opening the site: they describe what the code
// does (retention delays from apps/api/src/config.ts, cookies, AI and place services), so
// a change there means a change here.

export type LegalPage = "privacy" | "terms";

const fr: Record<LegalPage, string> = {
  privacy: `Dernière mise à jour : ${O.updatedAt}

Cette page explique quelles données ${O.site} traite, pourquoi, combien de temps il les garde et quels sont vos droits. Le responsable du traitement est **${O.name}**, ${O.address} (contact : ${O.contactEmail}).

## Données traitées
- **Compte** : adresse e-mail et mot de passe (stocké uniquement sous forme chiffrée, jamais en clair).
- **Contenu que vous ajoutez** : CV (texte et fichiers importés), photos, offres enregistrées ou ajoutées, CV générés et réglages.
- **Session** : un identifiant de session aléatoire, dans un cookie.
- **Messages envoyés avec « Un avis ? »** : le message, l'adresse e-mail si vous en indiquez une, la page d'où il est envoyé. Ils nous parviennent par e-mail ; nous les gardons le temps de les traiter, au plus un an.
- **Mesure d'audience** : pages vues, provenance (site ou moteur de recherche d'où vous venez), type d'appareil, navigateur, pays, et quelques actions (recherche et ses mots-clés, CV importé ou généré, téléchargement). Sans cookie et sans enregistrer votre adresse IP : les visites ne sont pas reliées à vous, ni d'un jour à l'autre. Si votre navigateur demande à ne pas être suivi (« Do Not Track »), rien n'est mesuré.
- **Technique** : pour la sécurité, l'adresse IP est utilisée quelques minutes, en mémoire, pour limiter les tentatives de connexion et d'inscription ; elle n'est pas enregistrée. Les journaux du serveur notent chaque requête (adresse appelée, résultat, durée) sans adresse IP ni contenu.

MonPoste n'utilise ni publicité ni traceur tiers. La mesure d'audience (Umami) est installée sur nos propres serveurs : aucune donnée n'est transmise à un tiers.

## Pourquoi
- Fournir le service que vous demandez : recherche d'offres, gestion de vos CV, génération de CV adaptés à une offre (exécution du contrat).
- Envoyer les e-mails du compte : confirmation d'adresse, réinitialisation du mot de passe (exécution du contrat).
- Protéger le site contre les abus (intérêt légitime).
- Savoir comment le site est utilisé pour l'améliorer, avec des statistiques anonymes (intérêt légitime ; mesure d'audience exemptée de consentement selon les conditions de la CNIL), et répondre à vos messages.

## Cookies et stockage du navigateur
- Un seul cookie, **session**, strictement nécessaire : il vous garde connecté (ou garde votre espace invité) pendant 30 jours, prolongés à chaque visite. Il n'est lisible que par le site.
- Le navigateur garde aussi vos préférences d'affichage (thème, langue, onglets ouverts). Elles ne quittent pas votre appareil.

Aucun de ces éléments ne sert à vous suivre : aucun consentement n'est donc demandé. La mesure d'audience n'utilise ni cookie ni stockage du navigateur.

## Services utilisés
- **Google Gemini** (intelligence artificielle) : quand vous importez un CV, le traduisez, ajoutez une offre à partir d'un texte ou générez un CV, le texte concerné (votre CV, l'offre) est envoyé à Google pour être traité. [À vérifier selon votre offre Gemini : avec l'API payante, Google n'utilise pas ces données pour améliorer ses produits.] Google peut traiter ces données hors de l'Union européenne, avec les garanties prévues par le RGPD (clauses contractuelles types).
- **Geoapify** (lieux) : le texte tapé dans le champ « lieu » de la recherche, sans aucune donnée vous concernant.
- **${O.emailProvider}** : envoi des e-mails du compte.
- **Hébergement** : ${O.host}.

Les offres d'emploi affichées proviennent des pages carrières publiques des employeurs.

## Durées de conservation
- Espace invité : supprimé après 30 jours sans visite.
- Compte supprimé : toutes ses données sont effacées sous 30 jours.
- CV et photos supprimés : effacés définitivement, fichiers compris, après 30 jours.
- Liens envoyés par e-mail : valables 1 heure (mot de passe) ou 48 heures (confirmation d'adresse).
- Sauvegardes de la base de données : 14 jours.
- Statistiques d'audience : 25 mois au plus.

## Vos droits
Vous pouvez accéder à vos données, les corriger, les supprimer, les récupérer dans un format courant, et vous opposer à un traitement ou en demander la limitation. Vous modifiez la plupart d'entre elles directement sur le site, et vous supprimez votre compte depuis les Réglages. Pour toute autre demande, écrivez à ${O.contactEmail} : nous répondons sous un mois.

Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL (cnil.fr).

## Sécurité
Connexions chiffrées (HTTPS), mots de passe chiffrés, cookie de session inaccessible aux scripts, accès à la base de données réservé au serveur.

## Modifications
Cette page peut évoluer avec le service. En cas de changement important, les titulaires d'un compte sont prévenus par e-mail.`,

  terms: `Dernière mise à jour : ${O.updatedAt}

## Le service
${O.site} aide à trouver des offres d'emploi et à préparer des CV adaptés à chacune. Le service est accessible sans compte (espace invité) ; un compte gratuit garde votre travail durablement et sur plusieurs appareils.

## Votre compte
Vous fournissez une adresse e-mail valide et gardez votre mot de passe pour vous. Vous pouvez supprimer votre compte à tout moment depuis les Réglages.

## Votre contenu
Les CV, photos et offres que vous ajoutez restent les vôtres. Vous devez avoir le droit de les utiliser (notamment pour les photos). Nous les utilisons uniquement pour vous rendre le service, comme décrit dans la politique de confidentialité.

## Contenu généré
Les CV générés, traductions et extractions sont produits par une intelligence artificielle à partir de vos informations. Ils peuvent contenir des erreurs : relisez-les avant de les envoyer. Vous restez responsable de ce que vous transmettez aux employeurs.

## Offres d'emploi
Les offres viennent des sites des employeurs et sont mises à jour régulièrement. Nous ne garantissons ni leur exactitude ni leur disponibilité, et ne participons pas aux recrutements.

## Utilisation acceptable
Il est interdit d'utiliser le site pour des contenus illicites, de tenter d'en perturber le fonctionnement, de contourner ses limites ou d'en extraire les données de manière automatisée. Un compte qui ne respecte pas ces règles peut être suspendu ou supprimé.

## Disponibilité et responsabilité
Le service est fourni tel quel, sans garantie de disponibilité permanente. Dans les limites permises par la loi, nous ne sommes pas responsables des décisions prises à partir des offres ou des contenus générés.

## Évolution
Ces conditions peuvent évoluer ; les titulaires d'un compte sont prévenus des changements importants par e-mail. Continuer à utiliser le site vaut acceptation de la nouvelle version.

## Droit applicable
Ces conditions sont soumises au droit français. En cas de litige, une solution amiable est recherchée en priorité ; vous pouvez aussi recourir gratuitement à un médiateur de la consommation [nom et site du médiateur].

## Mentions légales
- Éditeur : ${O.name}, ${O.legalForm}, ${O.registration}, ${O.address}
- Contact : ${O.contactEmail}
- Directeur de la publication : ${O.publicationDirector}
- Hébergeur : ${O.host}`,
};

const en: Record<LegalPage, string> = {
  privacy: `Last updated: ${O.updatedAt}

This page explains what data ${O.site} processes, why, how long it keeps it and what your rights are. The data controller is **${O.name}**, ${O.address} (contact: ${O.contactEmail}).

## Data processed
- **Account**: email address and password (stored only in hashed form, never in clear).
- **Content you add**: resumes (text and uploaded files), photos, saved or added offers, generated resumes and settings.
- **Session**: a random session identifier, in a cookie.
- **Messages sent with "Feedback?"**: the message, your email address if you give one, the page it was sent from. They reach us by email; we keep them as long as needed to handle them, one year at most.
- **Audience measurement**: pages viewed, origin (the site or search engine you came from), device type, browser, country, and a few actions (searches and their keywords, resume uploaded or generated, download). Without cookies and without storing your IP address: visits are not linked to you, nor from one day to the next. If your browser asks not to be tracked ("Do Not Track"), nothing is measured.
- **Technical**: for security, your IP address is used for a few minutes, in memory, to limit login and signup attempts; it is not stored. Server logs record each request (address called, result, duration) without IP address or content.

MonPoste uses no advertising and no third-party trackers. Audience measurement (Umami) runs on our own servers: no data goes to a third party.

## Why
- To provide the service you ask for: offer search, managing your resumes, generating resumes tailored to an offer (performance of the contract).
- To send account emails: address confirmation, password reset (performance of the contract).
- To protect the site against abuse (legitimate interest).
- To know how the site is used in order to improve it, with anonymous statistics (legitimate interest; audience measurement exempt from consent under the CNIL's conditions), and to answer your messages.

## Cookies and browser storage
- A single cookie, **session**, strictly necessary: it keeps you logged in (or keeps your guest space) for 30 days, extended at each visit. Only the site can read it.
- Your browser also keeps your display preferences (theme, language, open tabs). They never leave your device.

None of these is used to track you, so no consent is asked. Audience measurement uses no cookies and no browser storage.

## Services used
- **Google Gemini** (artificial intelligence): when you import a resume, translate it, add an offer from a text or generate a resume, the text concerned (your resume, the offer) is sent to Google for processing. [To check against your Gemini plan: with the paid API, Google does not use this data to improve its products.] Google may process this data outside the European Union, with the safeguards required by the GDPR (standard contractual clauses).
- **Geoapify** (places): the text typed in the search's "place" field, without any data about you.
- **${O.emailProvider}**: sending account emails.
- **Hosting**: ${O.host}.

The job offers shown come from employers' public career pages.

## Retention
- Guest space: deleted after 30 days without a visit.
- Deleted account: all its data is erased within 30 days.
- Deleted resumes and photos: permanently erased, files included, after 30 days.
- Links sent by email: valid for 1 hour (password) or 48 hours (address confirmation).
- Database backups: 14 days.
- Audience statistics: 25 months at most.

## Your rights
You can access your data, correct it, delete it, get it in a common format, object to a processing or ask for it to be restricted. You can change most of it directly on the site, and delete your account from the Settings. For any other request, write to ${O.contactEmail}: we answer within one month.

If you believe your rights are not respected, you can lodge a complaint with the CNIL (cnil.fr) or your local data protection authority.

## Security
Encrypted connections (HTTPS), hashed passwords, a session cookie scripts cannot read, database access restricted to the server.

## Changes
This page may change with the service. Account holders are told by email of any significant change.`,

  terms: `Last updated: ${O.updatedAt}

## The service
${O.site} helps you find job offers and prepare a resume tailored to each one. It can be used without an account (guest space); a free account keeps your work for good and across devices.

## Your account
You give a valid email address and keep your password to yourself. You can delete your account at any time from the Settings.

## Your content
The resumes, photos and offers you add remain yours. You must have the right to use them (photos in particular). We use them only to provide the service, as described in the privacy policy.

## Generated content
Generated resumes, translations and extractions are produced by artificial intelligence from your information. They may contain mistakes: read them before sending them. You remain responsible for what you send to employers.

## Job offers
Offers come from employers' sites and are updated regularly. We guarantee neither their accuracy nor their availability, and take no part in hiring.

## Acceptable use
You may not use the site for unlawful content, try to disrupt it, get around its limits or extract its data by automated means. An account that breaks these rules may be suspended or deleted.

## Availability and liability
The service is provided as is, with no guarantee of permanent availability. To the extent permitted by law, we are not liable for decisions made on the basis of the offers or of generated content.

## Changes
These terms may change; account holders are told of significant changes by email. Continuing to use the site means accepting the new version.

## Governing law
These terms are governed by French law. In case of dispute, an amicable solution is sought first; you may also turn, free of charge, to a consumer mediator [mediator's name and website].

## Legal notice
- Publisher: ${O.name}, ${O.legalForm}, ${O.registration}, ${O.address}
- Contact: ${O.contactEmail}
- Publication director: ${O.publicationDirector}
- Host: ${O.host}`,
};

export const LEGAL_TEXTS = { fr, en };
