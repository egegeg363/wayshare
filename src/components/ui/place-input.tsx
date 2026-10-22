"use client";

import { Globe2, Loader2, MapPin, Search, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { api, isAbortError } from "@/lib/api-client";
import { findCity, searchDirectory, type Place } from "@/lib/geo";
import { cn } from "@/lib/utils";

const POPULAR = ["Berlin", "Munich", "Hamburg", "Cologne", "Frankfurt", "Leipzig", "Amsterdam", "Vienna"]
  .map((name) => findCity(name))
  .filter((p): p is Place => p !== null);

type RemoteState = {
  query: string;
  status: "loading" | "done" | "error";
  results: Place[];
  source?: "nominatim" | "directory" | "offline";
};

type Row = { kind: "place"; place: Place } | { kind: "lookup"; query: string };

/**
 * Place picker: instant, offline matches from the built-in city directory as you type;
 * any street address or town via an explicit OpenStreetMap (Nominatim) lookup. Nominatim
 * is queried only on request — its usage policy forbids keystroke autocomplete.
 */
export function PlaceInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  icon,
  footer,
  error,
  className,
  inputClassName,
  variant = "field",
}: {
  id: string;
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  placeholder?: string;
  icon?: ReactNode;
  footer?: ReactNode;
  error?: string;
  className?: string;
  inputClassName?: string;
  /** "row" renders borderless, for stacking inside <ItineraryFields>. */
  variant?: "field" | "row";
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remote, setRemote] = useState<RemoteState | null>(null);

  const text = draft ?? value?.name ?? "";
  const query = (draft ?? "").trim();
  const remoteForQuery = remote && remote.query === query ? remote : null;

  const places: Place[] =
    remoteForQuery?.status === "done" && remoteForQuery.results.length > 0
      ? remoteForQuery.results
      : query
        ? searchDirectory(query, 6)
        : POPULAR;
  const rows: Row[] = places.map((place) => ({ kind: "place", place }));
  const remoteFound = remoteForQuery?.status === "done" && remoteForQuery.results.length > 0;
  if (query.length >= 3 && !remoteFound) rows.push({ kind: "lookup", query });
  const active = Math.min(activeIndex, Math.max(0, rows.length - 1));

  function choose(place: Place) {
    abortRef.current?.abort();
    onChange(place);
    setDraft(null);
    setRemote(null);
    setOpen(false);
  }

  async function lookup(q: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRemote({ query: q, status: "loading", results: [] });
    try {
      const response = await api.geocode(q, controller.signal);
      setRemote({ query: q, status: "done", results: response.results, source: response.source });
      setActiveIndex(0);
    } catch (err) {
      if (!isAbortError(err)) setRemote({ query: q, status: "error", results: [] });
    }
  }

  function activate(row: Row | undefined) {
    if (!row) return;
    if (row.kind === "place") choose(row.place);
    else void lookup(row.query);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + delta + rows.length) % Math.max(1, rows.length));
    } else if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      activate(rows[active]);
    } else if (event.key === "Escape") {
      if (open || draft !== null) {
        event.preventDefault();
        setOpen(false);
        setDraft(null);
      }
    }
  }

  const optionId = (index: number) => `${listId}-opt-${index}`;
  const showList = open && (rows.length > 0 || remoteForQuery?.status === "loading");

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute top-1/2 left-3.5 z-10 flex -translate-y-1/2 items-center text-ink-soft">
            {icon}
          </span>
        ) : null}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? optionId(active) : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            setDraft(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={(event) => {
            setOpen(true);
            event.target.select();
          }}
          onBlur={() => {
            setOpen(false);
            setDraft(null);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "h-12 w-full pr-9 text-[15px] text-ink outline-none placeholder:text-subtle",
            variant === "field"
              ? "rounded-xl border border-line bg-surface transition-[border-color,box-shadow] hover:border-line-strong focus:border-ink focus:ring-4 focus:ring-ink/[.06]"
              : "bg-transparent transition-colors hover:bg-black/[.015] focus:bg-black/[.025]",
            icon ? "pl-10" : "pl-3.5",
            error && (variant === "field" ? "border-danger/60" : "bg-danger-soft/60"),
            inputClassName,
          )}
        />
        {text ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Clear ${label.toLowerCase()}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              abortRef.current?.abort();
              setDraft(value ? null : "");
              setRemote(null);
              onChange(null);
              inputRef.current?.focus();
            }}
            className="absolute top-1/2 right-2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-black/[.05] hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {showList ? (
        <div
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-50 animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
          onMouseDown={(event) => event.preventDefault()}
        >
          <p className="px-3.5 pt-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">
            {remoteForQuery?.status === "done" && remoteForQuery.results.length
              ? remoteForQuery.source === "nominatim"
                ? "OpenStreetMap results"
                : "Built-in directory (OpenStreetMap offline)"
              : query
                ? "Cities & towns"
                : "Popular"}
          </p>
          <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto p-1.5 pt-0.5">
            {rows.map((row, index) => (
              <li
                key={row.kind === "place" ? `${row.place.name}-${row.place.lat}-${row.place.lng}` : "lookup"}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activate(row)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2",
                  index === active ? "bg-wash" : "hover:bg-wash/70",
                )}
              >
                {row.kind === "place" ? (
                  <>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface ring-1 ring-line">
                      <MapPin className="size-4 text-ink-soft" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{row.place.name}</span>
                      {row.place.detail ? (
                        <span className="block truncate text-xs text-muted">{row.place.detail}</span>
                      ) : null}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink text-white">
                      {remoteForQuery?.status === "loading" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Globe2 className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {remoteForQuery?.status === "loading"
                          ? "Searching OpenStreetMap…"
                          : remoteForQuery?.status === "done"
                            ? `No address found for “${row.query}”`
                            : `Search any address for “${row.query}”`}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {remoteForQuery?.status === "error"
                          ? "Lookup failed — try again or pick a city above"
                          : remoteForQuery?.status === "done"
                            ? remoteForQuery.source === "nominatim"
                              ? "Try a different spelling, or pick a city"
                              : "OpenStreetMap is unreachable — pick a city above"
                            : "Streets, stations, villages — via OpenStreetMap"}
                      </span>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {footer ? (
            <div className="flex items-center gap-2 border-t border-line bg-canvas px-3.5 py-2.5 text-xs text-muted">
              <Search className="size-3.5 shrink-0" />
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
      {error && variant === "field" ? <p className="mt-1.5 text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}
