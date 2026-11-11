import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { ContactLine } from "../contact-line";

export const metadata: Metadata = {
  title: "Contact — ClipPilot",
  description: "How to contact the ClipPilot team for support, privacy or data-deletion requests.",
};

export default function ContactPage() {
  return (
    <article>
      <h1>Contact</h1>
      <p className="meta">{SITE.name} is operated by {SITE.operator}.</p>

      <h2>Support, privacy and data requests</h2>
      <ContactLine />

      <h2>Revoke YouTube access yourself</h2>
      <p>
        In {SITE.name}: Settings → YouTube channel → Disconnect. Or at any time in your Google Account:{" "}
        <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
          myaccount.google.com/connections
        </a>
        .
      </p>

      <h2>Policies</h2>
      <p>
        <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link>
      </p>
    </article>
  );
}
