import Link from "next/link";
import { SITE } from "@/lib/site";

/** Public footer with the legal links Google's reviewers look for. */
export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-8 text-xs text-muted sm:px-6">
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
    </footer>
  );
}
