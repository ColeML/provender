// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, skipToken } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KrogerStoreRow } from "./kroger-store-row";

const calls = vi.hoisted(() => ({
  findLocations: vi.fn<(input: { zipCode: string }) => Promise<unknown[]>>(),
  setValues: vi.fn<(input: { values: Record<string, string> }) => Promise<void>>(),
}));

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    kroger: {
      findLocations: {
        queryOptions: (input: { zipCode: string } | typeof skipToken) => ({
          queryKey: ["kroger.findLocations", input],
          queryFn: input === skipToken ? skipToken : () => calls.findLocations(input),
        }),
      },
    },
    config: { setValues: { mutationOptions: () => ({ mutationFn: calls.setValues }) } },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

afterEach(() => {
  cleanup();
  calls.findLocations.mockReset();
  calls.setValues.mockReset();
});

const EDMOND = {
  locationId: "03500529",
  name: "Dillons - Edmond",
  chain: "DILLONS",
  address: "1 Main St, Edmond, OK",
};

function setup(props: Partial<React.ComponentProps<typeof KrogerStoreRow>> = {}) {
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <ul>
        <KrogerStoreRow locationId={undefined} name={undefined} configured {...props} />
      </ul>
    </QueryClientProvider>,
  );

  return user;
}

async function search(user: ReturnType<typeof userEvent.setup>, zipCode: string) {
  await user.click(screen.getByRole("button", { name: "Edit Kroger store" }));
  await user.type(screen.getByRole("textbox", { name: "ZIP code" }), zipCode);
  await user.click(screen.getByRole("button", { name: "Search" }));
}

describe("KrogerStoreRow", () => {
  it("shows the saved store's name", () => {
    setup({ locationId: "03500529", name: "Dillons - Edmond" });

    expect(screen.getByText("Dillons - Edmond")).toHaveClass("text-base");
  });

  it("shows the store number, muted, when no name was saved with it", () => {
    setup({ locationId: "61500066" });

    expect(screen.getByText("Store 61500066")).toHaveClass("text-muted-foreground");
  });

  it("reads Kroger isn't set up, with no pencil, when the server has no credentials", () => {
    setup({ locationId: "61500066", configured: false });

    expect(screen.getByText("Kroger isn't set up")).toHaveClass("text-muted-foreground");
    expect(screen.queryByRole("button", { name: "Edit Kroger store" })).toBeNull();
  });

  it("saves the picked store's id and name in one call", async () => {
    calls.findLocations.mockResolvedValue([EDMOND]);
    const user = setup();

    await search(user, "73034");
    await user.click(await screen.findByRole("button", { name: /Dillons - Edmond/ }));

    expect(calls.findLocations).toHaveBeenCalledWith({ zipCode: "73034" });
    expect(calls.setValues).toHaveBeenCalledTimes(1);
    expect(calls.setValues.mock.calls[0][0]).toEqual({
      values: { kroger_location_id: "03500529", kroger_location_name: "Dillons - Edmond" },
    });
  });

  it("lists each store's address so two of one chain can be told apart", async () => {
    calls.findLocations.mockResolvedValue([EDMOND]);
    const user = setup();

    await search(user, "73034");

    expect(await screen.findByText("1 Main St, Edmond, OK")).toBeInTheDocument();
  });

  it("says so when no stores are near the ZIP code", async () => {
    calls.findLocations.mockResolvedValue([]);
    const user = setup();

    await search(user, "99950");

    expect(await screen.findByText("No Kroger stores near 99950.")).toBeInTheDocument();
  });

  it("asks for five digits without searching", async () => {
    const user = setup();

    await search(user, "7303");

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a 5-digit ZIP code.");
    expect(calls.findLocations).not.toHaveBeenCalled();
  });

  it("shows a general message when the search fails for an unexplained reason", async () => {
    calls.findLocations.mockRejectedValue(new Error("boom"));
    const user = setup();

    await search(user, "73034");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not search for stores. Try again.",
    );
  });

  it("searches the same ZIP code again after a failure", async () => {
    calls.findLocations.mockRejectedValueOnce(new Error("boom")).mockResolvedValue([EDMOND]);
    const user = setup();

    await search(user, "73034");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("button", { name: /Dillons - Edmond/ })).toBeInTheDocument();
    expect(calls.findLocations).toHaveBeenCalledTimes(2);
  });

  it("hides the last search's stores when the new ZIP code is not five digits", async () => {
    calls.findLocations.mockResolvedValue([EDMOND]);
    const user = setup();

    await search(user, "73034");
    await screen.findByRole("button", { name: /Dillons - Edmond/ });
    await user.type(screen.getByRole("textbox", { name: "ZIP code" }), "{Backspace}");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.queryByRole("button", { name: /Dillons - Edmond/ })).toBeNull();
  });

  it("returns focus to the pencil once the picked store is saved", async () => {
    calls.findLocations.mockResolvedValue([EDMOND]);
    calls.setValues.mockResolvedValue();
    const user = setup();

    await search(user, "73034");
    await user.click(await screen.findByRole("button", { name: /Dillons - Edmond/ }));

    expect(await screen.findByRole("button", { name: "Edit Kroger store" })).toHaveFocus();
  });

  it("keeps the picker open with a message when the save fails", async () => {
    calls.findLocations.mockResolvedValue([EDMOND]);
    calls.setValues.mockRejectedValue(new Error("boom"));
    const user = setup();

    await search(user, "73034");
    await user.click(await screen.findByRole("button", { name: /Dillons - Edmond/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save the Kroger store. Try again.",
    );
    expect(screen.getByRole("textbox", { name: "ZIP code" })).toBeInTheDocument();
  });

  it("announces how many stores were found", async () => {
    calls.findLocations.mockResolvedValue([EDMOND]);
    const user = setup();

    await search(user, "73034");

    expect(await screen.findByRole("status")).toHaveTextContent("1 store found.");
  });

  it("closes without saving on Cancel and returns focus to the pencil", async () => {
    const user = setup();

    await user.click(screen.getByRole("button", { name: "Edit Kroger store" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Edit Kroger store" })).toHaveFocus();
    expect(calls.setValues).not.toHaveBeenCalled();
  });
});
