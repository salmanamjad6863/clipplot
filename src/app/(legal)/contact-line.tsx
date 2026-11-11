import { SITE } from "@/lib/site";

/** Contact sentence used on every legal page (email from NEXT_PUBLIC_CONTACT_EMAIL). */
export function ContactLine() {
  return SITE.email ? (
    <p>
      Questions, privacy or data-deletion requests: <a href={`mailto:${SITE.email}`}>{SITE.email}</a> ({SITE.operator}). We
      reply within 7 days.
    </p>
  ) : (
    <p>Questions, privacy or data-deletion requests: contact {SITE.operator} through the email address listed on our YouTube channels.</p>
  );
}
