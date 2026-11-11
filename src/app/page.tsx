"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, CalendarClock, CheckCircle2, Clapperboard, Radar, Sparkles, Upload } from "lucide-react";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";

const ease = [0.22, 1, 0.36, 1] as const;

const steps = [
  { icon: Radar, title: "Spot the trend", body: "Every morning ClipPilot scans what's going viral in your niche — links and stats only." },
  { icon: Sparkles, title: "Claude writes it", body: "Hook, script, captions, title, tags — tuned for Shorts retention." },
  { icon: Clapperboard, title: "Auto-render", body: "A worker cuts a 9:16 clip with burned-in captions and your branding." },
  { icon: CheckCircle2, title: "You approve", body: "One tap to ship or skip. Nothing posts without you." },
  { icon: Upload, title: "Publish", body: "Uploaded straight to your YouTube channel via the official API." },
  { icon: CalendarClock, title: "Daily autopilot", body: "Set a daily slot and let approved clips queue themselves." },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <Link
          href="/dashboard"
          className="glass rounded-full px-4 py-2 text-sm text-fg/90 transition hover:bg-surface-hover"
        >
          Open dashboard
        </Link>
      </header>

      <section className="pt-20 pb-24 text-center sm:pt-28">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease }}
          className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-muted"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_var(--success)]" />
          Daily GTA 6 Shorts pipeline
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.9, delay: 0.1, ease }}
          className="mx-auto mt-6 max-w-3xl font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
        >
          Today&apos;s viral moment,
          <br />
          <span className="text-sunset">on your channel by tonight.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25, ease }}
          className="mx-auto mt-6 max-w-xl text-base text-muted sm:text-lg"
        >
          ClipPilot finds what&apos;s trending, drafts a ready-to-post Short with Claude, and waits for your
          thumbs-up before uploading to YouTube.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href="/dashboard"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-sunset px-6 py-3 text-sm font-medium text-bg shadow-[0_8px_40px_-8px_var(--coral)] transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            Launch ClipPilot
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <a href="#how" className="rounded-full px-6 py-3 text-sm text-muted transition hover:text-fg">
            How it works
          </a>
        </motion.div>
      </section>

      <section id="how" className="pb-32">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.7, delay: i * 0.06, ease }}
              whileHover={{ y: -4 }}
              className="glass group rounded-2xl p-6 transition-colors hover:bg-surface-hover"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-amber transition-colors group-hover:text-coral">
                  <s.icon className="h-5 w-5" />
                </span>
                <span className="font-mono text-xs text-muted">0{i + 1}</span>
              </div>
              <h3 className="mt-5 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
