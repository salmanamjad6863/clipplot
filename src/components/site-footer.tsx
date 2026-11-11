import Link from "next/link";
import { SITE } from "@/lib/site";

/** Public footer with the legal links + YouTube API Services notice Google's reviewers look for. */
export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-6xl border-t border-border px-4 py-8 text-xs text-muted sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span>
          © 2026 {SITE.name}
          {SITE.operatorIsSet && ` · operated by ${SITE.operator}`}
        </span>
        <nav className="flex gap-5">
          <Link href="/privacy" className="hover:text-fg">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-fg">
            Terms of Service
          </Link>
          <Link href="/contact" className="hover:text-fg">
            Contact
          </Link>
        </nav>
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-[#ff0000]/15 px-2 py-0.5 font-medium text-[#ff6b6b]">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
            <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z" />
          </svg>
          YouTube API Services
        </span>
        <span>
          {SITE.name} uses YouTube API Services. By connecting a channel you agree to the{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" className="underline hover:text-fg">
            YouTube Terms of Service
          </a>{" "}
          and the{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" className="underline hover:text-fg">
            Google Privacy Policy
          </a>
          . See our{" "}
          <Link href="/privacy" className="underline hover:text-fg">
            Privacy Policy
          </Link>
          .
        </span>
      </p>
    </footer>
  );
}
