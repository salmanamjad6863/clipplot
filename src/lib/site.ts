/** Public site info used by the legal pages (set these in .env.local / Vercel env). */
export const SITE = {
  name: "ClipPilot",
  /** Who runs it — optional company/person name; defaults to a neutral team name */
  operator: process.env.NEXT_PUBLIC_OPERATOR_NAME || "the ClipPilot team",
  operatorIsSet: Boolean(process.env.NEXT_PUBLIC_OPERATOR_NAME),
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://clipplot.vercel.app",
  /** Public contact for privacy/support requests — Google reviewers check that one exists */
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "",
  effectiveDate: "11 November 2026",
};
