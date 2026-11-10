import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { MobileNav, Sidebar } from "@/components/sidebar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh">
      {/* usePathname() is request-time on dynamic routes, so the nav streams in */}
      <Suspense fallback={<aside className="hidden h-dvh w-60 shrink-0 border-r border-border lg:block" />}>
        <Sidebar />
      </Suspense>
      <div className="min-w-0 flex-1">
        <div className="px-4 pt-5 lg:hidden">
          <Logo />
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-8 lg:pb-16 lg:pt-10">{children}</main>
      </div>
      <Suspense>
        <MobileNav />
      </Suspense>
    </div>
  );
}
