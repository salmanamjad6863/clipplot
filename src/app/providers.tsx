"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, useSyncExternalStore } from "react";
import { Toaster } from "sonner";

const noopSubscribe = () => () => {};
/** false on the server and during hydration, true once mounted in the browser */
const useMounted = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  // Toasts are browser-only UI; rendering them after mount avoids a hydration mismatch
  const mounted = useMounted();

  return (
    <QueryClientProvider client={client}>
      {children}
      {mounted && <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: "rgb(14 14 23 / 0.9)",
            border: "1px solid rgb(255 255 255 / 0.08)",
            backdropFilter: "blur(16px)",
            color: "#f4f3f8",
          },
        }}
      />}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  );
}
