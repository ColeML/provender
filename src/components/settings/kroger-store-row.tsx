"use client";

import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { BUTTON, PENCIL } from "@/components/settings/setting-rows";
import { FIELD } from "@/components/ui/field";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const ZIP_CODE = /^\d{5}$/;

/** The Kroger failures whose message tells the household what to do; anything else does not. */
const EXPLAINED = new Set(["PRECONDITION_FAILED", "BAD_REQUEST", "SERVICE_UNAVAILABLE"]);

function failureMessage(error: unknown, fallback: string) {
  return isTRPCClientError(error) && EXPLAINED.has(error.data?.code ?? "")
    ? error.message
    : fallback;
}

function searchFailureMessage(error: unknown) {
  // The service's message for a refused request is written for the API's callers, not a ZIP search.
  if (isTRPCClientError(error) && error.data?.code === "BAD_REQUEST") {
    return "Kroger couldn't search near that ZIP code. Check it and try again.";
  }

  return failureMessage(error, "Could not search for stores. Try again.");
}

function searchStatus(fetching: boolean, found: unknown[] | undefined, zipCode: string | null) {
  if (fetching) {
    return "Searching…";
  }

  if (found === undefined) {
    return "";
  }

  if (found.length === 0) {
    return `No Kroger stores near ${zipCode}.`;
  }

  return found.length === 1 ? "1 store found." : `${found.length} stores found.`;
}

function StorePicker({ onPicked, onCancel }: { onPicked: () => void; onCancel: () => void }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [zipCode, setZipCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pending through the page refresh, as in the setting form, so the old store never reappears.
  const [saving, startSaving] = useTransition();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);

  // The pencil that opened the picker is gone, so focus would otherwise fall back to the page.
  useEffect(() => field.current?.focus(), []);

  const search = useQuery({
    ...trpc.kroger.findLocations.queryOptions(zipCode === null ? skipToken : { zipCode }),
    // Each failure has its own message, and Search is right there to try again.
    retry: false,
  });
  const save = useMutation(trpc.config.setValues.mutationOptions());

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = draft.trim();

    if (!ZIP_CODE.test(value)) {
      setError("Enter a 5-digit ZIP code.");
      setZipCode(null);

      return;
    }

    setError(null);

    // The same ZIP keeps the same query, which would otherwise sit on its last failure.
    if (value === zipCode) {
      void search.refetch();
    } else {
      setZipCode(value);
    }
  }

  function pick(locationId: string, name: string) {
    setError(null);
    startSaving(async () => {
      try {
        await save.mutateAsync({
          values: { kroger_location_id: locationId, kroger_location_name: name },
        });
      } catch (caught) {
        setError(failureMessage(caught, "Could not save the Kroger store. Try again."));

        return;
      }

      router.refresh();
      startSaving(onPicked);
    });
  }

  const found = search.isFetching ? undefined : search.data;
  const shownError = error ?? (search.isError ? searchFailureMessage(search.error) : null);
  const status = searchStatus(search.isFetching, found, zipCode);

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="text-muted-foreground text-xs">
            ZIP code
          </label>
          <input
            id={fieldId}
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            ref={field}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className={FIELD}
          />
        </div>

        {shownError === null ? null : (
          <p role="alert" className="text-destructive text-sm">
            {shownError}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={search.isFetching || saving}
            className={cn(BUTTON, "bg-primary text-primary-foreground")}
          >
            {search.isFetching ? "Searching…" : "Search"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className={cn(BUTTON, "text-muted-foreground")}
          >
            Cancel
          </button>
        </div>
      </form>

      {/* A search can take seconds, so its progress is announced. Only "no stores" is shown. */}
      <output className={found?.length === 0 ? "text-muted-foreground text-sm" : "sr-only"}>
        {status}
      </output>

      {found === undefined || found.length === 0 ? null : (
        <ul aria-label="Stores found" className="divide-border border-border divide-y border-t">
          {found.map((location) => (
            <li key={location.locationId}>
              <button
                type="button"
                disabled={saving}
                onClick={() => pick(location.locationId, location.name)}
                className="focus-visible:ring-ring flex min-h-11 w-full flex-col items-start gap-0.5 rounded-lg px-2 py-2.5 text-left focus-visible:ring-3 focus-visible:outline-none disabled:opacity-40"
              >
                <span className="text-base">{location.name}</span>
                <span className="text-muted-foreground text-sm">{location.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface KrogerStoreRowProps {
  locationId: string | undefined;
  name: string | undefined;
  /** False when the deployment has no Kroger credentials, so there is nothing to search. */
  configured: boolean;
}

/** The Kroger store prices come from, picked from the stores near a ZIP code. */
export function KrogerStoreRow({ locationId, name, configured }: KrogerStoreRowProps) {
  const [editing, setEditing] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  // Set only by closing the picker, so the page's first render never takes focus.
  const closedPicker = useRef(false);

  useEffect(() => {
    if (!editing && closedPicker.current) {
      closedPicker.current = false;
      pencil.current?.focus();
    }
  }, [editing]);

  function close() {
    closedPicker.current = true;
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="py-3">
        <StorePicker onPicked={close} onCancel={close} />
      </li>
    );
  }

  // A store saved before the picker existed has an id and no name.
  const display = !configured
    ? "Kroger isn't set up"
    : name || (locationId ? `Store ${locationId}` : "Not set");
  const muted = !configured || !name;

  return (
    <li className="flex items-start gap-2 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-4 gap-y-0.5 py-2.5">
        <span className="text-base">Kroger store</span>
        <span
          className={cn(
            "ml-auto min-w-0 text-right break-words",
            muted ? "text-muted-foreground text-sm" : "text-base",
          )}
        >
          {display}
        </span>
      </div>

      {configured ? (
        <button
          ref={pencil}
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit Kroger store"
          className={PENCIL}
        >
          <Pencil aria-hidden className="size-4" />
        </button>
      ) : (
        // Keeps the value lined up with the rows above, which all end in a pencil.
        <span aria-hidden className="min-w-11 shrink-0" />
      )}
    </li>
  );
}
