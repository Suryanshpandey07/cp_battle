import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ServerDown } from "./app/App";
import { probeServer, refreshSession, type ServerState } from "./net/api";
import { useAuth } from "./state/auth";
import { applyDocumentSettings, useSettings } from "./state/settings";
import "./styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } } });

function Boot() {
  const [server, setServer] = useState<ServerState | "checking">("checking");
  const start = useCallback(async () => {
    setServer("checking");
    const state = await probeServer();
    setServer(state);
    if (state !== "ok") return;
    await refreshSession();
    const p = useAuth.getState().profile;
    if (p?.settings) useSettings.getState().hydrate(p.settings as never);
    useAuth.getState().markReady();
  }, []);
  useEffect(() => {
    applyDocumentSettings(useSettings.getState().s);
    void start();
  }, [start]);
  // Keep trying while the server is away, so starting it is enough.
  useEffect(() => {
    if (server !== "unreachable" && server !== "foreign") return;
    const id = window.setTimeout(() => void start(), 4000);
    return () => window.clearTimeout(id);
  }, [server, start]);
  if (server === "unreachable" || server === "foreign") return <ServerDown kind={server} onRetry={() => void start()} />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Boot />
    </QueryClientProvider>
  </StrictMode>,
);
