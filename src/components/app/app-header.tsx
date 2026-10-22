"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CarFront, Check, ChevronDown, Loader2, Search, Star, WalletCards } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { UserDTO } from "@/lib/contracts";
import { formatEur } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, Skeleton } from "@/components/ui/primitives";
import { useApp } from "./app-provider";
import { LogoMark } from "./logo";

const MODES = [
  { href: "/", label: "Find a Ride", short: "Find", icon: Search },
  { href: "/offer", label: "Offer a Ride", short: "Offer", icon: CarFront },
  { href: "/trips", label: "My Trips & Wallet", short: "Trips & Wallet", icon: WalletCards },
] as const;

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-xl" aria-label="WayShare home">
          <LogoMark />
          <span className="text-[17px] font-semibold tracking-tight">WayShare</span>
        </Link>
        <nav aria-label="Mode" className="hidden flex-1 justify-center md:flex">
          <ModeSwitcher />
        </nav>
        <div className="ml-auto md:ml-0">
          <UserSwitcher />
        </div>
      </div>
      <nav aria-label="Mode" className="border-t border-line px-4 py-2 md:hidden">
        <ModeSwitcher compact />
      </nav>
    </header>
  );
}

function ModeSwitcher({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  return (
    <div className={cn("flex rounded-2xl bg-wash p-1 ring-1 ring-inset ring-line/70", compact && "w-full")}>
      {MODES.map(({ href, label, short, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium whitespace-nowrap transition-all",
              compact ? "h-9 flex-1 px-2 text-[13px]" : "h-9",
              active
                ? "bg-surface text-ink shadow-[0_1px_2px_rgb(17_17_17/0.08)] ring-1 ring-line"
                : "text-muted hover:text-ink",
            )}
          >
            <Icon className={cn("size-4", active ? "text-ink" : "text-subtle")} strokeWidth={2.2} />
            {compact ? short : label}
          </Link>
        );
      })}
    </div>
  );
}

function UserSwitcher() {
  const { users, currentUser, status, switchUser, switchingTo, errorMessage } = useApp();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Transient UI: close if this subtree is ever hidden.
  useLayoutEffect(() => () => setOpen(false), []);

  if (status === "error") {
    return (
      <span className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger" title={errorMessage ?? ""}>
        Demo data unavailable
      </span>
    );
  }
  if (!currentUser) {
    return (
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="hidden h-4 w-24 sm:block" />
      </div>
    );
  }

  const passengers = users.filter((u) => !u.isDriver);
  const drivers = users.filter((u) => u.isDriver);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface py-1.5 pr-2.5 pl-1.5 text-left transition-colors hover:border-line-strong"
      >
        <Avatar src={currentUser.avatarUrl} name={currentUser.name} size={32} />
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-36 truncate text-[13px] leading-tight font-semibold">{currentUser.name}</span>
          <span className="block text-xs leading-tight text-muted">
            {currentUser.isDriver ? "Driver" : "Passenger"} ·{" "}
            <span className="tabular text-ink-soft">{formatEur(currentUser.walletBalance)}</span>
          </span>
        </span>
        <span className="tabular rounded-lg bg-wash px-2 py-1 text-xs font-semibold sm:hidden">
          {formatEur(currentUser.walletBalance)}
        </span>
        {switchingTo ? (
          <Loader2 className="size-4 animate-spin text-muted" />
        ) : (
          <ChevronDown className={cn("size-4 text-muted transition-transform", open && "rotate-180")} />
        )}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Switch demo account"
          className="absolute top-[calc(100%+8px)] right-0 z-50 w-[300px] animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
        >
          <div className="border-b border-line bg-canvas px-4 py-3">
            <p className="text-[13px] font-semibold text-ink">Switch demo account</p>
            <p className="text-xs text-muted">Test both sides of a trip — no password needed.</p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-1.5">
            <AccountGroup
              title="Passengers"
              users={passengers}
              currentId={currentUser.id}
              switchingTo={switchingTo}
              onSelect={(id) => {
                setOpen(false);
                if (id !== currentUser.id) void switchUser(id);
              }}
            />
            <AccountGroup
              title="Drivers"
              users={drivers}
              currentId={currentUser.id}
              switchingTo={switchingTo}
              onSelect={(id) => {
                setOpen(false);
                if (id !== currentUser.id) void switchUser(id);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AccountGroup({
  title,
  users,
  currentId,
  switchingTo,
  onSelect,
}: {
  title: string;
  users: UserDTO[];
  currentId: string;
  switchingTo: string | null;
  onSelect: (id: string) => void;
}) {
  if (users.length === 0) return null;
  return (
    <div className="py-1">
      <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">{title}</p>
      {users.map((user) => {
        const active = user.id === currentId;
        return (
          <button
            key={user.id}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => onSelect(user.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
              active ? "bg-wash" : "hover:bg-wash/70",
            )}
          >
            <Avatar src={user.avatarUrl} name={user.name} size={36} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <span className="truncate">{user.name}</span>
                <span className="inline-flex items-center gap-0.5 text-xs font-normal text-muted">
                  <Star className="size-3 fill-ink text-ink" />
                  {user.rating.toFixed(1)}
                </span>
              </span>
              <span className="block truncate text-xs text-muted">
                {user.isDriver ? `${user.vehicleModel} · ${user.vehiclePlate}` : "Passenger"}
              </span>
            </span>
            <span className="flex flex-col items-end gap-0.5">
              <span className="tabular text-[13px] font-semibold text-ink">{formatEur(user.walletBalance)}</span>
              {switchingTo === user.id ? (
                <Loader2 className="size-3.5 animate-spin text-muted" />
              ) : active ? (
                <Check className="size-3.5 text-accent" strokeWidth={3} />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
