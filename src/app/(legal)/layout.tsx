import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";

/** Public pages (no login): Privacy Policy, Terms of Service, Contact. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-6 sm:px-6">
        <Logo />
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
      </header>
      <main className="legal mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">{children}</main>
      <SiteFooter />
    </>
  );
}
