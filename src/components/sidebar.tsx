"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import clsx from "clsx";
import { Inbox, LayoutDashboard, Library, LogOut, Radar, Settings, SquarePlay } from "lucide-react";
import { Logo } from "./logo";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { useClips, useSettings } from "@/lib/queries";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/review", label: "Review", icon: Inbox, badge: true },
  { href: "/library", label: "Library", icon: Library },
  { href: "/trends", label: "Trends", icon: Radar },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function useReviewCount() {
  const { data } = useClips();
  return data?.filter((c) => c.status === "awaiting_approval").length ?? 0;
}

export function Sidebar() {
  const pathname = usePathname();
  const reviewCount = useReviewCount();
  const { data: settings } = useSettings();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-bg/40 px-4 py-6 backdrop-blur-xl lg:flex">
      <div className="px-2">
        <Logo />
      </div>
      <div className="mt-6">
        <WorkspaceSwitcher />
      </div>
      <nav className="mt-6 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                active ? "text-fg" : "text-muted hover:text-fg",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="absolute inset-0 rounded-xl border border-border bg-white/[0.06]"
                />
              )}
              <item.icon className={clsx("relative h-4 w-4", active && "text-coral")} />
              <span className="relative flex-1">{item.label}</span>
              {"badge" in item && reviewCount > 0 && (
                <span className="relative rounded-full bg-coral px-1.5 text-[10px] font-semibold leading-4 text-bg">
                  {reviewCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="glass mt-auto rounded-2xl p-3 text-xs">
        <div className="flex items-center gap-2">
          <SquarePlay className="h-4 w-4 text-coral" />
          <span className="font-medium">YouTube</span>
          <span
            className={clsx(
              "ml-auto h-2 w-2 rounded-full",
              settings?.youtubeConnected ? "bg-success shadow-[0_0_8px_var(--success)]" : "bg-white/20",
            )}
          />
        </div>
        <p className="mt-1 truncate text-muted">
          {settings?.youtubeConnected ? (settings.youtubeChannelTitle ?? "Channel connected") : "Not connected yet"}
        </p>
        <p className="mt-2 text-muted">
          Autopilot: <span className={settings?.autopilot ? "text-success" : "text-fg/70"}>{settings?.autopilot ? "On" : "Off"}</span>
        </p>
      </div>
      <SignOut />
    </aside>
  );
}

function SignOut() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
      }}
      className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted transition hover:bg-white/5 hover:text-fg"
    >
      <LogOut className="h-3.5 w-3.5" /> Sign out
    </button>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const reviewCount = useReviewCount();
  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 flex justify-around rounded-2xl border border-border bg-bg-elev/80 px-2 py-2 backdrop-blur-xl lg:hidden">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx("relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px]", active ? "text-fg" : "text-muted")}
          >
            {active && (
              <motion.span layoutId="mnav-active" className="absolute inset-0 rounded-xl bg-white/[0.07]" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
            )}
            <item.icon className={clsx("relative h-5 w-5", active && "text-coral")} />
            <span className="relative">{item.label}</span>
            {"badge" in item && reviewCount > 0 && (
              <span className="absolute right-1.5 top-0.5 h-2 w-2 rounded-full bg-coral" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
