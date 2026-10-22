"use client";

import Link from "next/link";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { api, toApiError } from "@/lib/api-client";
import type { UserDTO } from "@/lib/contracts";
import { useResource } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
type Toast = {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  action?: { label: string; href: string };
};
type ToastInput = Omit<Toast, "id" | "tone"> & { tone?: ToastTone };

type AppContextValue = {
  users: UserDTO[];
  currentUser: UserDTO | null;
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
  /** Bumped after every mutation or account switch; views include it in their fetch keys. */
  dataVersion: number;
  refresh: () => void;
  switchUser: (userId: string) => Promise<void>;
  switchingTo: string | null;
  notify: (toast: ToastInput) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = use(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}

let toastSequence = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [dataVersion, setDataVersion] = useState(0);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const users = useResource(`users:${dataVersion}`, (signal) => api.users(signal));

  const refresh = useCallback(() => setDataVersion((v) => v + 1), []);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const notify = useCallback(
    (toast: ToastInput) => {
      const id = ++toastSequence;
      setToasts((list) => [...list.slice(-2), { tone: "success", ...toast, id }]);
      setTimeout(() => dismiss(id), toast.action ? 7000 : 4500);
    },
    [dismiss],
  );

  const switchUser = useCallback(
    async (userId: string) => {
      setSwitchingTo(userId);
      try {
        const { user } = await api.switchUser(userId);
        refresh();
        notify({
          tone: "info",
          title: `You're now ${user.name}`,
          description: user.isDriver ? `Driver · ${user.vehicleModel}` : "Passenger account",
        });
      } catch (error) {
        notify({ tone: "error", title: "Couldn't switch account", description: toApiError(error).message });
      } finally {
        setSwitchingTo(null);
      }
    },
    [notify, refresh],
  );

  const value = useMemo<AppContextValue>(() => {
    const list = users.data?.users ?? [];
    const currentUser = list.find((u) => u.id === users.data?.currentUserId) ?? null;
    return {
      users: list,
      currentUser,
      status: users.data ? "ready" : users.error ? "error" : "loading",
      errorMessage: users.error?.message ?? null,
      dataVersion,
      refresh,
      switchUser,
      switchingTo,
      notify,
    };
  }, [users.data, users.error, dataVersion, refresh, switchUser, switchingTo, notify]);

  return (
    <AppContext value={value}>
      {value.status === "error" ? <SetupNeeded message={value.errorMessage} onRetry={refresh} /> : children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </AppContext>
  );
}

function SetupNeeded({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-card">
      <p className="text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">Setup needed</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">WayShare couldn&apos;t load its demo accounts</h1>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <p className="mt-4 rounded-xl bg-canvas px-4 py-3 text-left font-mono text-[13px] text-ink-soft ring-1 ring-line">
        npm run setup
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-medium text-white hover:bg-[#2a2a2a]"
      >
        Try again
      </button>
    </div>
  );
}

const toastIcon: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="size-[18px] text-accent" />,
  error: <XCircle className="size-[18px] text-danger" />,
  info: <Info className="size-[18px] text-ink-soft" />,
};

function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm animate-rise-in items-start gap-3 rounded-2xl border bg-surface p-4 shadow-pop",
            toast.tone === "error" ? "border-red-200" : "border-line",
          )}
        >
          <span className="mt-px">{toastIcon[toast.tone]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{toast.title}</p>
            {toast.description ? <p className="mt-0.5 text-[13px] text-muted">{toast.description}</p> : null}
            {toast.action ? (
              <Link
                href={toast.action.href}
                onClick={() => onDismiss(toast.id)}
                className="mt-2 inline-flex text-[13px] font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
              >
                {toast.action.label}
              </Link>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="-m-1 rounded-lg p-1 text-subtle hover:bg-black/[.05] hover:text-ink"
            aria-label="Dismiss notification"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
