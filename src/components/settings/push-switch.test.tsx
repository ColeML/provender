// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCClientError } from "@trpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PushSwitch } from "./push-switch";

const calls = vi.hoisted(() => ({
  vapidPublicKey: vi.fn<() => Promise<string | null>>(),
  subscribe: vi.fn<(input: unknown) => Promise<void>>(),
  unsubscribe: vi.fn<(input: { endpoint: string }) => Promise<void>>(),
  sendTest: vi.fn<(input: { endpoint: string }) => Promise<{ sent: boolean; gone?: boolean }>>(),
}));

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    push: {
      vapidPublicKey: {
        queryOptions: () => ({ queryKey: ["push.vapidPublicKey"], queryFn: calls.vapidPublicKey }),
      },
      subscribe: { mutationOptions: () => ({ mutationFn: calls.subscribe }) },
      unsubscribe: { mutationOptions: () => ({ mutationFn: calls.unsubscribe }) },
      sendTest: { mutationOptions: () => ({ mutationFn: calls.sendTest }) },
    },
  }),
}));

const ENDPOINT = "https://push.example/phone";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

const bytesOf = (base64url: string) =>
  Uint8Array.from(atob(base64url.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
    char.charCodeAt(0),
  ).buffer;

/** A browser subscription, as `pushManager` hands one back, made with `key`. */
function browserSubscription(key = KEY) {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: bytesOf(key) },
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "key", auth: "auth" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

let current: ReturnType<typeof browserSubscription> | null;
let permission: NotificationPermission;
let requestPermission: ReturnType<typeof vi.fn<() => Promise<NotificationPermission>>>;
let pushSubscribe: ReturnType<typeof vi.fn>;
let installing: { state: string; addEventListener: () => void } | null;
let registeredLate: boolean;

/** Installs a browser with push: a registered worker, a push manager and a Notification API. */
function installBrowser({
  userAgent = "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0",
  standalone = false,
  push = true,
  registered = true,
} = {}) {
  pushSubscribe = vi.fn(async () => {
    current = browserSubscription();

    return current;
  });

  const registration = {
    get installing() {
      return installing;
    },
    waiting: null,
    update: async () => {},
    pushManager: { getSubscription: async () => current, subscribe: pushSubscribe },
  };

  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: standalone && query.includes("standalone"),
  }));

  if (!push) {
    return;
  }

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: registered ? Promise.resolve(registration) : new Promise(() => {}),
      // `registeredLate`: the layout's registration has started but not finished.
      getRegistration: async () => (registered && !registeredLate ? registration : undefined),
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", {
    get permission() {
      return permission;
    },
    requestPermission,
  });
}

beforeEach(() => {
  current = null;
  installing = null;
  registeredLate = false;
  permission = "default";
  requestPermission = vi.fn(async () => {
    permission = "granted";

    return permission;
  });
  calls.vapidPublicKey.mockResolvedValue(
    "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  );
  calls.subscribe.mockResolvedValue(undefined);
  calls.unsubscribe.mockResolvedValue(undefined);
  calls.sendTest.mockResolvedValue({ sent: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
  for (const call of Object.values(calls)) {
    call.mockReset();
  }
});

function setup() {
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <ul>
        <PushSwitch />
      </ul>
    </QueryClientProvider>,
  );

  return user;
}

const theSwitch = () => screen.getByRole("switch", { name: /Prep reminders/ });

async function enabledSwitch() {
  const control = theSwitch();

  await vi.waitFor(() => expect(control).not.toHaveAttribute("aria-disabled", "true"));
  await vi.waitFor(() => expect(control).not.toHaveAttribute("data-disabled"));

  return control;
}

describe("PushSwitch", () => {
  it("asks for permission from the tap, then saves this device's subscription", async () => {
    installBrowser();
    const user = setup();

    await user.click(await enabledSwitch());

    expect(requestPermission).toHaveBeenCalled();
    expect(calls.subscribe).toHaveBeenCalledWith(
      { endpoint: ENDPOINT, keys: { p256dh: "key", auth: "auth" } },
      expect.anything(),
    );
    expect(pushSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    );
    await vi.waitFor(() => expect(theSwitch()).toBeChecked());
    expect(screen.getByRole("button", { name: "Send test" })).toBeInTheDocument();
  });

  it("does not wait for a new worker that finished activating before it looked", async () => {
    installBrowser();
    // Already activated, so no `statechange` will ever arrive.
    installing = { state: "activated", addEventListener: () => {} };
    const user = setup();

    await user.click(await enabledSwitch());

    await vi.waitFor(() => expect(theSwitch()).toBeChecked());
  });

  it("will not subscribe under the old worker when the updated one fails to install", async () => {
    installBrowser();
    installing = { state: "redundant", addEventListener: () => {} };
    const user = setup();

    await user.click(await enabledSwitch());

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not turn on reminders.");
    expect(pushSubscribe).not.toHaveBeenCalled();
    expect(theSwitch()).not.toBeChecked();
  });

  it("replaces a subscription made with an old VAPID key, which subscribe would refuse", async () => {
    installBrowser();
    const old = browserSubscription(
      "BOld0000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    );
    current = old;
    const user = setup();

    await user.click(await enabledSwitch());

    expect(calls.unsubscribe).toHaveBeenCalledWith({ endpoint: ENDPOINT }, expect.anything());
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(pushSubscribe).toHaveBeenCalled();
    await vi.waitFor(() => expect(theSwitch()).toBeChecked());
  });

  it("keeps a subscription already made with this key", async () => {
    installBrowser();
    const existing = browserSubscription();
    current = existing;
    const user = setup();

    await user.click(await enabledSwitch());

    expect(existing.unsubscribe).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(theSwitch()).toBeChecked());
  });

  it("stays off with a message saying how to allow notifications when permission is denied", async () => {
    installBrowser();
    requestPermission.mockResolvedValue("denied");
    const user = setup();

    await user.click(await enabledSwitch());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Allow them in your browser's site settings/,
    );
    expect(theSwitch()).not.toBeChecked();
    expect(calls.subscribe).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send test" })).not.toBeInTheDocument();
  });

  it("tells an installed iPhone app where to allow notifications", async () => {
    installBrowser({ userAgent: IPHONE, standalone: true });
    requestPermission.mockResolvedValue("denied");
    const user = setup();

    await user.click(await enabledSwitch());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Settings → Notifications → Provender/,
    );
  });

  it("explains how to install on iPhone in Safari, instead of asking for permission", async () => {
    installBrowser({ userAgent: IPHONE, push: false });
    const user = setup();

    expect(await screen.findByText(/tap Share, then Add to Home Screen/)).toBeInTheDocument();
    await user.click(theSwitch());

    expect(theSwitch()).not.toBeChecked();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("says so in a browser that cannot receive notifications", async () => {
    installBrowser({ push: false });
    setup();

    expect(
      await screen.findByText("This browser can't receive notifications."),
    ).toBeInTheDocument();
  });

  it("says so when no service worker is registered, as in next dev", async () => {
    installBrowser({ registered: false });
    setup();

    expect(
      await screen.findByText(/need the app's service worker/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(theSwitch()).toHaveAttribute("data-disabled");
  });

  it("waits for the registration the layout is still making, on a browser's first visit", async () => {
    installBrowser();
    registeredLate = true;
    const user = setup();

    await user.click(await enabledSwitch());

    await vi.waitFor(() => expect(theSwitch()).toBeChecked());
  });

  it("is off and says so when the server has no VAPID key", async () => {
    installBrowser();
    calls.vapidPublicKey.mockResolvedValue(null);
    setup();

    expect(await screen.findByText(/aren't set up on this server/)).toBeInTheDocument();
    expect(theSwitch()).toHaveAttribute("data-disabled");
  });

  it("shows on for a device that is already subscribed", async () => {
    installBrowser();
    current = browserSubscription();
    permission = "granted";
    setup();

    await vi.waitFor(() => expect(theSwitch()).toBeChecked());
  });

  it("removes this device's subscription when turned off", async () => {
    installBrowser();
    const subscription = browserSubscription();
    current = subscription;
    permission = "granted";
    const user = setup();

    await vi.waitFor(() => expect(theSwitch()).toBeChecked());
    await user.click(await enabledSwitch());

    expect(calls.unsubscribe).toHaveBeenCalledWith({ endpoint: ENDPOINT }, expect.anything());
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(theSwitch()).not.toBeChecked();
  });

  it("turns back on with a message when the server cannot remove the subscription", async () => {
    installBrowser();
    const subscription = browserSubscription();
    current = subscription;
    permission = "granted";
    calls.unsubscribe.mockRejectedValue(new Error("offline"));
    const user = setup();

    await vi.waitFor(() => expect(theSwitch()).toBeChecked());
    await user.click(await enabledSwitch());

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not turn off reminders.");
    expect(theSwitch()).toBeChecked();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("sends a test push to this device", async () => {
    installBrowser();
    current = browserSubscription();
    permission = "granted";
    const user = setup();

    await user.click(await screen.findByRole("button", { name: "Send test" }));

    expect(calls.sendTest).toHaveBeenCalledWith({ endpoint: ENDPOINT }, expect.anything());
    expect(await screen.findByRole("status")).toHaveTextContent("Test sent.");
  });

  it("turns off and asks to subscribe again when the server has no row for this device", async () => {
    installBrowser();
    current = browserSubscription();
    permission = "granted";
    calls.sendTest.mockRejectedValue(
      new TRPCClientError("gone", { result: { error: { data: { code: "NOT_FOUND" } } } } as never),
    );
    const user = setup();

    await user.click(await screen.findByRole("button", { name: "Send test" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer subscribed/);
    expect(theSwitch()).not.toBeChecked();
  });

  it("turns off and asks to subscribe again when the push service says the subscription is gone", async () => {
    installBrowser();
    current = browserSubscription();
    permission = "granted";
    calls.sendTest.mockResolvedValue({ sent: false, gone: true });
    const user = setup();

    await user.click(await screen.findByRole("button", { name: "Send test" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no longer subscribed. Turn reminders on again/,
    );
    expect(theSwitch()).not.toBeChecked();
  });

  it("saves the same subscription again when turned back on after a refused test", async () => {
    installBrowser();
    const subscription = browserSubscription();
    current = subscription;
    permission = "granted";
    calls.sendTest.mockResolvedValue({ sent: false, gone: true });
    const user = setup();

    await user.click(await screen.findByRole("button", { name: "Send test" }));
    await screen.findByRole("alert");
    await user.click(await enabledSwitch());

    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(pushSubscribe).toHaveBeenCalled();
    await vi.waitFor(() => expect(theSwitch()).toBeChecked());
  });
});
