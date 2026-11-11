import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { ContactLine } from "../contact-line";

export const metadata: Metadata = {
  title: "Privacy Policy — ClipPilot",
  description: "How ClipPilot accesses, uses, stores and deletes data, including data from YouTube API Services.",
};

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="meta">
        Effective {SITE.effectiveDate} · {SITE.name} ({SITE.url}) is operated by {SITE.operator}.
      </p>

      <div className="note">
        <p style={{ marginTop: 0 }}>
          <b>In short:</b> {SITE.name} is a private, internal tool that helps {SITE.operator} research trending topics and
          publish original videos to <b>our own YouTube channels</b>. It uses <b>YouTube API Services</b>. By connecting a
          YouTube channel you agree to the{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            YouTube Terms of Service
          </a>
          , and Google&apos;s handling of data is described in the{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          . We never sell data, never use it for advertising, and never download or re-upload other creators&apos; videos.
        </p>
      </div>

      <h2>1. Who can use ClipPilot</h2>
      <p>
        {SITE.name} is not a public service. Only people authorized by {SITE.operator} can sign in (password protected), and
        only channels owned or managed by {SITE.operator} are connected to it. This policy covers the data of those channels
        and the public YouTube data the tool reads.
      </p>

      <h2>2. YouTube API Services we use</h2>
      <ul>
        <li>
          <b>YouTube Data API</b> — to search public videos for trending topics (titles, channel names, view counts,
          durations, links), to upload our videos, set thumbnails, create playlists and add our videos to them, post a comment
          on our own videos, and read the statistics of our own videos.
        </li>
        <li>
          <b>YouTube Analytics API</b> (read-only) — to read the average percentage watched of videos on our own connected
          channels.
        </li>
      </ul>

      <h2>3. What data we access and store</h2>
      <h3>From a connected YouTube channel (with the channel owner&apos;s permission through Google OAuth)</h3>
      <ul>
        <li>The channel ID and channel name.</li>
        <li>
          An OAuth refresh token, stored <b>encrypted (AES-256-GCM)</b> on our server, used only to act on that channel when
          we upload or manage our own videos. Short-lived access tokens are never stored.
        </li>
        <li>For videos published through {SITE.name}: the video ID and link, playlist ID, views, likes, comment counts and average % watched.</li>
      </ul>
      <h3>Public YouTube data (no account needed)</h3>
      <ul>
        <li>
          Metadata of public trending videos: title, channel name, view count, duration, publish time, link, and the
          uploader&apos;s public subscriber count. We store <b>links and metadata only — never the videos themselves</b>.
        </li>
      </ul>
      <h3>Data we create</h3>
      <ul>
        <li>Scripts, titles, descriptions and settings for our own videos, and the rendered videos (full versions stay on our own computer; small previews are kept in our storage for review).</li>
      </ul>

      <h2>4. How we use the data</h2>
      <ul>
        <li>To find which topics are trending in our niche, so we can make our own original commentary videos about them.</li>
        <li>To upload, organize (playlists) and publish videos to our own channels — always after a person on our team reviews and approves each video.</li>
        <li>To measure how our own videos perform and improve future videos.</li>
      </ul>
      <p>We do not use YouTube data for advertising, profiling individuals, or any purpose unrelated to running our channels.</p>

      <h2>5. Sharing</h2>
      <p>We never sell or rent data. We share data only with service providers that run {SITE.name} for us:</p>
      <ul>
        <li><b>Google / YouTube</b> — the APIs above.</li>
        <li><b>Supabase</b> — database and file storage.</li>
        <li><b>Vercel</b> — website hosting.</li>
        <li>
          <b>Anthropic (Claude API)</b> — to draft scripts we send public trend metadata (video titles, channel names, view
          rates) and the titles, hooks and performance numbers of <i>our own</i> videos. No account tokens or personal data
          are sent.
        </li>
      </ul>
      <p>We may disclose data if required by law.</p>

      <h2>6. Retention and deletion</h2>
      <ul>
        <li>Public trend metadata from YouTube is deleted automatically <b>30 days</b> after it was retrieved.</li>
        <li>Statistics of our own videos are refreshed every few hours; any statistic not refreshed within <b>30 days</b> is deleted.</li>
        <li>Review previews are deleted <b>7 days</b> after a video is published (the video itself lives on YouTube).</li>
        <li>Disconnecting a channel in Settings revokes our access with Google and deletes its stored token immediately.</li>
        <li>Deleting a workspace deletes all of its settings, trends, clips, statistics and previews.</li>
      </ul>

      <h2>7. Revoking access</h2>
      <p>
        A channel owner can revoke {SITE.name}&apos;s access at any time in Settings → Disconnect, or through Google&apos;s
        security settings at{" "}
        <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
          myaccount.google.com/connections
        </a>{" "}
        (also reachable via{" "}
        <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noreferrer">
          security.google.com/settings/security/permissions
        </a>
        ). After revocation we can no longer access the channel, and you can ask us to delete any remaining data (see
        Contact).
      </p>

      <h2>8. Cookies and similar storage</h2>
      <p>
        We use only essential cookies: a sign-in session cookie, a cookie remembering the selected workspace, and short-lived
        cookies that protect the Google sign-in flow. We use no advertising or analytics cookies and no third-party trackers.
      </p>

      <h2>9. Security</h2>
      <p>
        Data is sent over HTTPS. Database access is restricted to our server (row-level security blocks browser access),
        OAuth tokens are encrypted at rest, and the dashboard requires a password.
      </p>

      <h2>10. Google API Services User Data Policy</h2>
      <p>
        {SITE.name}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>11. Changes</h2>
      <p>We will update this page if our practices change and revise the effective date above.</p>

      <h2>12. Contact</h2>
      <ContactLine />
      <p>
        See also our <Link href="/terms">Terms of Service</Link>.
      </p>
    </article>
  );
}
