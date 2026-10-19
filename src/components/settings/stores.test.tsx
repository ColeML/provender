// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreList, type SettingsStore, type StoreDraft } from "./stores";

afterEach(cleanup);

const aldi: SettingsStore = {
  id: "aldi",
  name: "Aldi",
  notes: "Cheapest produce",
  primary: true,
};

function setup(stores: SettingsStore[] = []) {
  const onCreate = vi.fn<(draft: StoreDraft) => Promise<void>>().mockResolvedValue();
  const onUpdate = vi.fn<(id: string, draft: StoreDraft) => Promise<void>>().mockResolvedValue();
  const onDelete = vi.fn<(id: string) => Promise<void>>().mockResolvedValue();
  const user = userEvent.setup();

  render(<StoreList stores={stores} onCreate={onCreate} onUpdate={onUpdate} onDelete={onDelete} />);

  return { user, onCreate, onUpdate, onDelete };
}

function setupWithRerender() {
  const handlers = {
    onCreate: vi.fn<(draft: StoreDraft) => Promise<void>>().mockResolvedValue(),
    onUpdate: vi.fn<(id: string, draft: StoreDraft) => Promise<void>>().mockResolvedValue(),
    onDelete: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(),
  };
  const user = userEvent.setup();
  const { rerender } = render(<StoreList stores={[]} {...handlers} />);

  return { user, rerender, handlers };
}

/** The add form is folded away behind a button until asked for. */
async function openAddForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "+ Add store" }));
}

describe("StoreList", () => {
  it("folds the add form away until asked, and folds it again on cancel", async () => {
    const { user } = setup([aldi]);

    expect(screen.queryByRole("textbox", { name: "Store" })).not.toBeInTheDocument();

    await openAddForm(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox", { name: "Store" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add store" })).toBeInTheDocument();
  });

  it("makes the first store the main one by default", async () => {
    const { user, onCreate } = setup();

    await openAddForm(user);
    await user.type(screen.getByRole("textbox", { name: "Store" }), "Aldi");
    await user.type(
      screen.getByRole("textbox", { name: "Notes for the planner" }),
      "Cheapest produce",
    );
    await user.click(screen.getByRole("button", { name: "Add store" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "Aldi",
      notes: "Cheapest produce",
      primary: true,
    });
    // Folded away again once saved.
    expect(await screen.findByRole("button", { name: "+ Add store" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Store" })).not.toBeInTheDocument();
  });

  it("does not make a later store the main one unless asked", async () => {
    const { user, onCreate } = setup([aldi]);

    await openAddForm(user);
    await user.type(screen.getByRole("textbox", { name: "Store" }), "Braum's");
    await user.click(screen.getByRole("button", { name: "Add store" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ primary: false }));
  });

  it("unticks Main store for the next store once the first one is saved", async () => {
    const { user, rerender, handlers } = setupWithRerender();

    await openAddForm(user);
    await user.type(screen.getByRole("textbox", { name: "Store" }), "Aldi");
    await user.click(screen.getByRole("button", { name: "Add store" }));
    // What the page refresh does after a save.
    rerender(<StoreList stores={[aldi]} {...handlers} />);
    await openAddForm(user);

    expect(screen.getByRole("checkbox", { name: /Main store/ })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "Store" })).toHaveValue("");
  });

  it("refuses a name that is already a store, before sending it", async () => {
    const { user, onCreate } = setup([aldi]);

    await openAddForm(user);
    await user.type(screen.getByRole("textbox", { name: "Store" }), "ALDI");
    await user.click(screen.getByRole("button", { name: "Add store" }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("ALDI is already one of your stores.");
  });

  it("keeps what was typed when the save fails", async () => {
    const { user, onCreate } = setup();

    onCreate.mockRejectedValue(new Error("offline"));
    await openAddForm(user);
    await user.type(screen.getByRole("textbox", { name: "Store" }), "Aldi");
    await user.click(screen.getByRole("button", { name: "Add store" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save that store.");
    expect(screen.getByRole("textbox", { name: "Store" })).toHaveValue("Aldi");
  });

  it("shows each store's notes and which is the main one", () => {
    setup([aldi, { id: "braums", name: "Braum's", notes: null, primary: false }]);

    expect(screen.getByText("Cheapest produce")).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getByText("Main store")).toBeInTheDocument();
  });

  it("edits a store's notes in place, keeping its own name", async () => {
    const { user, onUpdate } = setup([aldi]);

    await user.click(screen.getByRole("button", { name: "Edit Aldi" }));

    // The edit form takes the row's place in the list.
    const notes = within(screen.getByRole("list")).getByRole("textbox", {
      name: "Notes for the planner",
    });

    await user.clear(notes);
    await user.type(notes, "Produce and eggs");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onUpdate).toHaveBeenCalledWith("aldi", {
      name: "Aldi",
      notes: "Produce and eggs",
      primary: true,
    });
    expect(await screen.findByRole("button", { name: "Edit Aldi" })).toBeInTheDocument();
  });

  it("asks before deleting a store", async () => {
    const { user, onDelete } = setup([aldi]);

    await user.click(screen.getByRole("button", { name: "Delete Aldi" }));

    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith("aldi");
  });

  it("deletes nothing when the household keeps the store", async () => {
    const { user, onDelete } = setup([aldi]);

    await user.click(screen.getByRole("button", { name: "Delete Aldi" }));
    await user.click(screen.getByRole("button", { name: "Keep" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
