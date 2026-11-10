import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Suspense fallback={<div className="skeleton h-56 rounded-2xl" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
