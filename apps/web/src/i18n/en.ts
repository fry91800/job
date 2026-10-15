import type { fr } from "./fr";

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

// English texts: same keys as fr.ts.
export const en: Shape<typeof fr> = {
  app: { name: "Job" },
  tools: {
    resumes: "Resumes",
    photos: "Photos",
    saved: "Saved offers",
    history: "Generated resumes",
    settings: "Settings",
  },
  account: {
    guest: "Guest",
    menu: "Account",
    logIn: "Log in",
    signUp: "Sign up",
    soon: "soon",
    theme: "Theme",
    themes: { light: "Light", dark: "Dark", system: "System" },
    language: "Language",
  },
  search: {
    keywords: "Job, skill, company…",
    location: "City, county, region…",
    filters: "Filters",
    addOffer: "Add an offer",
    comingSoon: "Search comes with the next step.",
  },
  sidebar: { collapse: "Collapse the panel", expand: "Expand the panel", resize: "Resize the panel" },
  tabs: {
    kinds: {
      offer: "Offer",
      generated: "Generated resume",
      resumes: "Resumes",
      photos: "Photos",
      saved: "Saved offers",
      history: "Generated resumes",
      settings: "Settings",
      "add-offer": "Add an offer",
    },
    close: "Close",
    closeOthers: "Close others",
    closeAll: "Close all",
    keepOpen: "Keep open",
    preview: "Preview (double-click to keep the tab open)",
    switcher: "Open tabs",
    back: "Back",
    unsavedTitle: "Close without saving?",
    unsavedText: "This tab has unsaved changes. They will be lost.",
    unsavedConfirm: "Close anyway",
    cancel: "Cancel",
    placeholder: "This tab will be built in step {{step}} of the plan (FRONTEND.md §8).",
  },
  welcome: {
    title: "Find an offer, tailor your resume",
    text: "Search thousands of offers on the left. Open several, compare them, and generate a resume tailored to each one.",
    upload: "Upload my resume",
    uploadHint: "To see how well you match each offer and generate tailored resumes.",
    searchHint: "Start with a search in the left panel.",
  },
};
