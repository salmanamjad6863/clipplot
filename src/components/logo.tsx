import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 group">
      <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-sunset shadow-[0_0_24px_-4px_var(--coral)] transition-transform duration-500 group-hover:rotate-12">
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-bg" aria-hidden>
          <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z" />
        </svg>
      </span>
      <span className="font-display text-lg font-semibold tracking-tight">
        Clip<span className="text-sunset">Pilot</span>
      </span>
    </Link>
  );
}
