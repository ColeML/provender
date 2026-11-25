"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState, useSyncExternalStore } from "react";

import { BUTTON } from "@/components/settings/setting-rows";
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/** What this browser can do about push, worked out once it is known to be a browser. */
export type PushSupport = "checking" | "supported" | "install-first" | "unsupported";

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac, but no Mac has a touch screen.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}

/** Nothing here changes while the page is open, so there is nothing to subscribe to. */
const noChanges = () => () => {};

export function detectPushSupport(): PushSupport {
  // iOS Safari offers push only to an app added to the Home Screen, and in a tab it has no
  // PushManager at all, so this comes before the feature check that would call it unsupported.
  if (isIos() && !isInstalled()) {
    return "install-first";
  }

  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }

  return "supported";
}

/** A VAPID key arrives base64url; `subscribe` is only guaranteed to accept the raw bytes. */
function keyBytes(base64url: string) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Whether a browser subscription was made with this VAPID key. */
function sameKey(subscription: PushSubscription, key: Uint8Array) {
  const current = subscription.options.applicationServerKey;

  if (!current) {
    return false;
  }

  const bytes = new Uint8Array(current);

  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/**
 * The registration once its newest worker is the active one. A worker from before push existed
 * has no `push` handler, and a device subscribed under it would drop the first reminder.
 */
async function activeRegistration() {
  const registration = await navigator.serviceWorker.ready;

  await registration.update().catch(() => {});

  const pending = registration.installing ?? registration.waiting;

  if (pending) {
    await new Promise<void>((resolve) => {
      const settled = () => pending.state === "activated" || pending.state === "redundant";

      pending.addEventListener("statechange", () => settled() && resolve());

      // It may have finished between reading `installing` and adding the listener.
      if (settled()) {
        resolve();
      }
    });
  }

  return registration;
}

const DENIED = {
  ios: "Notifications are blocked for Provender. Allow them in Settings → Notifications → Provender, then try again.",
  other:
    "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
};

const SUPPORT_MESSAGE: Partial<Record<PushSupport, string>> = {
  "install-first":
    "To get reminders on iPhone, tap Share, then Add to Home Screen, and open Provender from there.",
  unsupported: "This browser can't receive notifications.",
};

export function PushSwitch() {
  const trpc = useTRPC();
  // "checking" on the server and through hydration, then the browser's real answer.
  const support = useSyncExternalStore(noChanges, detectPushSupport, () => "checking" as const);
  const labelId = useId();
  const hintId = useId();
  // `RegisterServiceWorker` registers the worker in production builds only, so `next dev` has
  // none, and `serviceWorker.ready` would never resolve.
  const [worker, setWorker] = useState<"checking" | "registered" | "missing">("checking");
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const key = useQuery(trpc.push.vapidPublicKey.queryOptions());
  const subscribe = useMutation(trpc.push.subscribe.mutationOptions());
  // A stable function, unlike the mutation object, so the effect below runs once.
  const resave = useMutation(trpc.push.subscribe.mutationOptions()).mutate;
  const unsubscribe = useMutation(trpc.push.unsubscribe.mutationOptions());
  const sendTest = useMutation(trpc.push.sendTest.mutationOptions());

  // Whether this device is subscribed is the browser's to say, not the server's.
  useEffect(() => {
    if (support !== "supported") {
      return;
    }

    const read = async () => {
      const registration = await navigator.serviceWorker.getRegistration();

      if (!registration) {
        setWorker("missing");

        return;
      }

      const subscription = await registration.pushManager.getSubscription();
      const subscribed = Boolean(subscription) && Notification.permission === "granted";

      setWorker("registered");
      setOn(subscribed);

      // Saved again on every visit, so a device whose row is gone (it was moved to another
      // household, or deleted) is not left showing on while nothing reaches it.
      const { endpoint, keys } = subscription?.toJSON() ?? {};

      if (subscribed && endpoint && keys?.p256dh && keys.auth) {
        resave({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
      }
    };

    void read();
  }, [support, resave]);

  async function turnOn() {
    // First, while the tap is still a user gesture: Safari refuses a prompt that comes after an
    // await.
    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      setMessage({ text: isIos() ? DENIED.ios : DENIED.other, error: true });

      return;
    }

    if (!key.data) {
      return;
    }

    const applicationServerKey = keyBytes(key.data);
    const registration = await activeRegistration();
    const existing = await registration.pushManager.getSubscription();

    // `subscribe` refuses outright while a subscription made with another key exists, which is
    // every device after the deployment's keys change.
    if (existing && !sameKey(existing, applicationServerKey)) {
      await existing.unsubscribe();
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    const { endpoint, keys } = subscription.toJSON();

    if (!endpoint || !keys?.p256dh || !keys.auth) {
      await subscription.unsubscribe();
      throw new Error("The browser returned a subscription without keys");
    }

    try {
      await subscribe.mutateAsync({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
    } catch (error) {
      // A browser subscription the server never heard of would look on and never deliver.
      await subscription.unsubscribe();
      throw error;
    }

    setOn(true);
  }

  async function turnOff() {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();

    setOn(false);

    if (!subscription) {
      return;
    }

    try {
      await unsubscribe.mutateAsync({ endpoint: subscription.endpoint });
    } catch (error) {
      setOn(true);
      throw error;
    }

    await subscription.unsubscribe();
  }

  async function toggle(checked: boolean) {
    setBusy(true);
    setMessage(null);

    try {
      await (checked ? turnOn() : turnOff());
    } catch {
      setMessage({
        text: checked
          ? "Could not turn on reminders. Try again."
          : "Could not turn off reminders. Try again.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (!subscription) {
        setOn(false);
        setMessage({ text: "This device isn't subscribed. Turn reminders on again.", error: true });

        return;
      }

      const result = await sendTest.mutateAsync({ endpoint: subscription.endpoint });

      if (result.sent) {
        setMessage({ text: "Test sent. It should arrive in a few seconds.", error: false });
      } else {
        await subscription.unsubscribe();
        setOn(false);
        setMessage({
          text: "This device's subscription had expired. Turn reminders on again.",
          error: true,
        });
      }
    } catch {
      setMessage({ text: "Could not send a test notification. Try again.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const unavailable =
    SUPPORT_MESSAGE[support] ??
    (worker === "missing"
      ? "Notifications need the app's service worker, which isn't running in this browser."
      : undefined);
  const notSetUp = key.isSuccess && key.data === null;
  const disabled =
    busy || support !== "supported" || worker !== "registered" || !key.isSuccess || notSetUp;

  return (
    <li className="py-3">
      <div className="flex min-h-11 items-center justify-between gap-4">
        <span className="flex flex-col">
          <span id={labelId} className="text-base">
            Prep reminders
          </span>
          <span id={hintId} className="text-muted-foreground text-sm">
            A notification on this device the evening before a dish that needs prep.
          </span>
        </span>
        {/* The taller hit area makes the 20px track a 44px target. */}
        <Switch
          aria-labelledby={labelId}
          aria-describedby={hintId}
          checked={on}
          onCheckedChange={(checked) => void toggle(checked)}
          disabled={disabled}
          className="data-unchecked:border-muted-foreground after:-inset-y-3"
        />
      </div>

      {unavailable ? <p className="text-muted-foreground mt-2 text-sm">{unavailable}</p> : null}
      {notSetUp && !unavailable ? (
        <p className="text-muted-foreground mt-2 text-sm">
          Notifications aren&apos;t set up on this server yet.
        </p>
      ) : null}

      {on ? (
        <button
          type="button"
          onClick={() => void test()}
          disabled={busy}
          className={cn(BUTTON, "border-border mt-2 border")}
        >
          Send test
        </button>
      ) : null}

      {/* Always rendered, so a screen reader is already listening when the message arrives. */}
      <output className="text-muted-foreground mt-2 block text-sm empty:hidden">
        {message && !message.error ? message.text : null}
      </output>
      {message?.error ? (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {message.text}
        </p>
      ) : null}
    </li>
  );
}
