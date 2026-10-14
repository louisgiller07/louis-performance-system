// Site-wide copy shared by every page (header, footer, health disclaimer).
// Page copy lives next to its pages: content/home.ts (homepage),
// content/pages.ts (inner pages), content/domains.ts (the seven coaching
// domains).
//
// Honesty rules for every copy file (NALYNT — Marketing Website V1.1 brief,
// still in force): every claim is grounded in real, shipped behavior; banned
// phrasing — "IA magique", "remplace un coach", "l'IA apprend toute seule",
// any unproven promise. ART-02 (HPM): no free / beta / price wording until the
// offer is validated; downhill (DH) scope only.

import { loginHref } from "./home.ts";

export interface NavLink {
  label: string;
  href: string;
}

export const siteCopy = {
  disclaimer: {
    text: "NALYNT ne remplace pas un médecin, un physiothérapeute, un ostéopathe ou tout autre professionnel de santé. Il oriente vers eux quand nécessaire.",
  },

  /** Header: the three inner pages that carry the story. */
  headerNav: [
    { label: "Coaching", href: "/coaching" },
    { label: "Comment ça marche", href: "/comment-ca-marche" },
    { label: "À propos", href: "/a-propos" },
  ] satisfies NavLink[],

  /** Footer: every real route of the site. */
  footerGroups: [
    {
      title: "Découvrir",
      links: [
        { label: "Le coaching", href: "/coaching" },
        { label: "Comment ça marche", href: "/comment-ca-marche" },
        { label: "Philosophie", href: "/philosophie" },
      ],
    },
    {
      title: "NALYNT",
      links: [
        { label: "À propos", href: "/a-propos" },
        { label: "Contact", href: "/contact" },
        { label: "L'application", href: loginHref },
        { label: "Confidentialité", href: "/confidentialite" },
      ],
    },
  ] satisfies { title: string; links: NavLink[] }[],
};
