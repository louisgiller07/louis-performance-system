// Site-wide copy shared by every page (header, footer, health disclaimer).
// Page copy lives next to its pages: content/home.ts (homepage),
// content/pages.ts (/comment-ca-marche, /coaching, /philosophie, /a-propos,
// /contact), content/domains.ts (the seven coaching domains).
//
// Honesty rules for every copy file (NALYNT — Marketing Website V1.1 brief,
// still in force): every claim is grounded in real, shipped behavior; banned
// phrasing — "IA magique", "remplace un coach", "l'IA apprend toute seule",
// any unproven promise. Do not reintroduce them without re-checking.
//
// V3 — the former page-specific fields (hero, storyOrigin, dayWithNalynt,
// aiCoachModel, keyMessages, aboutPage, about, limits, contactPage,
// closingCta, coreValueProposition) moved to the files above or were
// rewritten there; see git history for the earlier wording.

export interface DisclaimerCopy {
  text: string;
}

export interface NavLink {
  label: string;
  href: string;
}

export interface SiteCopy {
  disclaimer: DisclaimerCopy;
  nav: NavLink[];
  /** V3 — the header's three centred primary links; the full `nav` stays in the footer and the mobile menu. */
  headerNav: NavLink[];
}

export const siteCopy: SiteCopy = {
  disclaimer: {
    text: "NALYNT ne remplace pas un médecin, un physiothérapeute, un ostéopathe ou tout autre professionnel de santé. Il oriente vers eux quand nécessaire.",
  },

  nav: [
    { label: "Accueil", href: "/" },
    { label: "Comment ça marche", href: "/comment-ca-marche" },
    { label: "Coaching", href: "/coaching" },
    { label: "Philosophie", href: "/philosophie" },
    { label: "À propos", href: "/a-propos" },
    { label: "Contact", href: "/contact" },
  ],

  headerNav: [
    { label: "Coaching", href: "/coaching" },
    { label: "Comment ça marche", href: "/comment-ca-marche" },
    { label: "Application", href: "/#produit" },
  ],
};
