"use client";

import { ArrowDownLeft, Lock, Plus, RotateCcw, WalletCards } from "lucide-react";
import { useState } from "react";
import { api, toApiError } from "@/lib/api-client";
import type { TransactionDTO, TripsResponse } from "@/lib/contracts";
import type { TransactionType } from "@/lib/domain";
import { formatDateTime, formatEur, formatSignedEur } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/app-provider";
import { Button } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/primitives";

const TX_META: Record<TransactionType, { label: string; icon: React.ReactNode; tint: string }> = {
  TOP_UP: { label: "Top-up", icon: <Plus className="size-4" />, tint: "bg-wash text-ink-soft" },
  ESCROW_HOLD: { label: "Escrow hold", icon: <Lock className="size-4" />, tint: "bg-ink text-white" },
  DRIVER_PAYOUT: { label: "Driver payout", icon: <ArrowDownLeft className="size-4" />, tint: "bg-accent text-white" },
  REFUND: { label: "Refund", icon: <RotateCcw className="size-4" />, tint: "bg-accent-soft text-accent-strong" },
};

export function WalletPanel({ wallet }: { wallet: TripsResponse["wallet"] }) {
  const { refresh, notify } = useApp();
  const [toppingUp, setToppingUp] = useState(false);

  async function topUp() {
    setToppingUp(true);
    try {
      const { user } = await api.topUp(50);
      notify({ title: "€50.00 added", description: `New balance ${formatEur(user.walletBalance)}` });
      refresh();
    } catch (error) {
      notify({ tone: "error", title: "Top-up failed", description: toApiError(error).message });
    } finally {
      setToppingUp(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="bg-ink p-5 text-white sm:p-6">
        <p className="flex items-center gap-2 text-[13px] text-white/65">
          <WalletCards className="size-4" />
          Wallet balance
        </p>
        <p className="tabular mt-2 text-[40px] leading-none font-semibold tracking-tight">{formatEur(wallet.balance)}</p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <MiniStat label="In escrow" value={formatEur(wallet.heldInEscrow)} hint="Your seats" />
          <MiniStat label="Pending" value={formatEur(wallet.pendingPayouts)} hint="Awaiting PINs" />
          <MiniStat label="Paid out" value={formatEur(wallet.totalPaidOut)} hint="Lifetime" accent />
        </div>
        <Button
          variant="secondary"
          className="mt-5 w-full border-white/10 bg-white text-ink hover:bg-white/90"
          onClick={topUp}
          loading={toppingUp}
        >
          <Plus className="size-4" />
          €50 Test Top-Up
        </Button>
      </div>

      <div className="p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <Eyebrow>Ledger</Eyebrow>
          <span className="text-xs text-muted">{wallet.transactions.length} entries</span>
        </div>
        {wallet.transactions.length === 0 ? (
          <p className="text-sm text-muted">No transactions yet.</p>
        ) : (
          <ul className="-mx-2 max-h-[460px] space-y-0.5 overflow-y-auto">
            {wallet.transactions.map((tx) => (
              <LedgerRow key={tx.id} tx={tx} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function MiniStat({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[.07] px-3 py-2.5 ring-1 ring-inset ring-white/10">
      <p className="text-[11px] text-white/55">{label}</p>
      <p className={cn("tabular mt-0.5 text-sm font-semibold", accent ? "text-[#34d399]" : "text-white")}>{value}</p>
      <p className="mt-0.5 text-[10px] text-white/40">{hint}</p>
    </div>
  );
}

function LedgerRow({ tx }: { tx: TransactionDTO }) {
  const meta = TX_META[tx.type];
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-canvas">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", meta.tint)}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{tx.description}</p>
        <p className="text-xs text-muted">
          {meta.label} · {formatDateTime(tx.createdAt)}
        </p>
      </div>
      <span className={cn("tabular text-[13px] font-semibold", tx.amount > 0 ? "text-accent-strong" : "text-ink")}>
        {formatSignedEur(tx.amount)}
      </span>
    </li>
  );
}
