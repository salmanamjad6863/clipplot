import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { ContactLine } from "../contact-line";

export const metadata: Metadata = {
  title: "Terms of Service — ClipPilot",
  description: "Terms for using ClipPilot, an internal YouTube publishing tool.",
};

export default function TermsPage() {
  return (
    <article>
      <h1>Terms of Service</h1>
      <p className="meta">
        Effective {SITE.effectiveDate} · {SITE.name} ({SITE.url}) is operated by {SITE.operator}.
      </p>

      <h2>1. What ClipPilot is</h2>
      <p>
        {SITE.name} is an internal tool used by {SITE.operator} to research trending gaming topics, draft original video
        scripts, render videos, and publish them — after human review — to YouTube channels owned or managed by{" "}
        {SITE.operator}. It is not offered to the public.
      </p>

      <h2>2. Who may use it</h2>
      <p>
        Only people authorized by {SITE.operator} may sign in. Access credentials must not be shared. We may remove access at
        any time.
      </p>

      <h2>3. YouTube</h2>
      <p>
        {SITE.name} uses YouTube API Services. By connecting a YouTube channel, you agree to be bound by the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          YouTube Terms of Service
        </a>{" "}
        and acknowledge the{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Google Privacy Policy
        </a>
        . You may only connect channels you own or are authorized to manage.
      </p>

      <h2>4. Content rules</h2>
      <ul>
        <li>Every video must be reviewed and approved by a person before it is uploaded.</li>
        <li>
          Videos must be original: our own commentary over our own gameplay footage, short official trailer excerpts used
          under fair use, licensed material, or original graphics. Downloading or re-uploading other creators&apos; videos is
          not allowed.
        </li>
        <li>
          Videos must follow YouTube&apos;s Community Guidelines, copyright rules and monetization policies. Rumors must be
          presented as rumors; misleading titles or thumbnails are not allowed.
        </li>
        <li>The channel owner remains responsible for everything published on their channel.</li>
      </ul>

      <h2>5. AI-assisted content</h2>
      <p>
        Scripts and metadata are drafted with the help of an AI model (Anthropic Claude) and narration may use synthetic
        voices. Drafts can be wrong; the reviewer is responsible for checking facts before approving. Where YouTube requires
        disclosure of altered or synthetic content, it must be disclosed.
      </p>

      <h2>6. Availability and changes</h2>
      <p>
        {SITE.name} is provided &quot;as is&quot;, without warranties of any kind. Features may change or stop. To the
        extent permitted by law, {SITE.operator} is not liable for indirect or consequential losses, including lost views or
        revenue.
      </p>

      <h2>7. Privacy</h2>
      <p>
        How we handle data — including data from YouTube API Services — is described in our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>8. Contact</h2>
      <ContactLine />
    </article>
  );
}
