"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Lock } from "lucide-react";
import { ease, inputCls } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // only allow same-site relative redirects
  const raw = params.get("next") ?? "/dashboard";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace(next);
      router.refresh();
    } else {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.7, ease }}
      className="glass rounded-2xl p-6"
    >
      <h1 className="font-display text-xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Enter your ClipPilot password.</p>
      <label className="relative mt-6 block">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          className={`${inputCls} pl-9`}
        />
      </label>
      {error && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 text-sm text-danger">
          {error}
        </motion.p>
      )}
      <button
        type="submit"
        disabled={busy || !password}
        className="group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-sunset px-5 py-2.5 text-sm font-medium text-bg transition-transform enabled:hover:scale-[1.02] enabled:active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </button>
    </motion.form>
  );
}
