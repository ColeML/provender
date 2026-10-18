// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuleList, type RuleDraft, type SettingsRule } from "./ingredient-stores";

afterEach(cleanup);

const stores = [
  { id: "aldi", name: "Aldi" },
  { id: "braums", name: "Braum's" },
];

function setup(rules: SettingsRule[] = [], storeList = stores) {
  const onAdd = vi.fn<(draft: RuleDraft) => Promise<void>>().mockResolvedValue();
  const onDelete = vi.fn<(id: string) => Promise<void>>().mockResolvedValue();
  const user = userEvent.setup();

  render(<RuleList rules={rules} stores={storeList} onAdd={onAdd} onDelete={onDelete} />);

  return { user, onAdd, onDelete };
}

describe("RuleList", () => {
  it("sends every comma-separated ingredient to the chosen store, only there by default", async () => {
    const { user, onAdd } = setup();

    await user.type(
      screen.getByRole("textbox", { name: "Ingredients" }),
      "milk, buttermilk, , hamburger buns",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "From" }), "braums");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledWith({
      names: ["milk", "buttermilk", "hamburger buns"],
      storeId: "braums",
      only: true,
    });
    expect(screen.getByRole("textbox", { name: "Ingredients" })).toHaveValue("");
  });

  it("sends a usual store when only is unticked", async () => {
    const { user, onAdd } = setup();

    await user.type(screen.getByRole("textbox", { name: "Ingredients" }), "ground beef");
    await user.click(screen.getByRole("checkbox", { name: /Only buy it here/ }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledWith({ names: ["ground beef"], storeId: "aldi", only: false });
  });

  it("keeps what was typed when the save fails", async () => {
    const { user, onAdd } = setup();

    onAdd.mockRejectedValue(new Error("offline"));
    await user.type(screen.getByRole("textbox", { name: "Ingredients" }), "milk");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save that.");
    expect(screen.getByRole("textbox", { name: "Ingredients" })).toHaveValue("milk");
  });

  it("lists the ingredients under the store they come from", () => {
    setup([
      { id: "milk", name: "milk", storeId: "braums", only: true },
      { id: "ground-beef", name: "ground beef", storeId: "aldi", only: false },
    ]);

    const braums = screen.getByRole("heading", { name: "Braum's" }).parentElement;

    if (braums === null) {
      throw new Error("no Braum's section");
    }

    expect(within(braums).getByText("milk")).toBeInTheDocument();
    expect(within(braums).getByText("Only here")).toBeInTheDocument();
    expect(screen.getByText("Usually here")).toBeInTheDocument();
  });

  it("deletes a rule by its ingredient's id", async () => {
    const { user, onDelete } = setup([{ id: "milk", name: "milk", storeId: "braums", only: true }]);

    await user.click(screen.getByRole("button", { name: "Stop setting a store for milk" }));

    expect(onDelete).toHaveBeenCalledWith("milk");
  });

  it("asks for a store before any ingredient can be sent to one", () => {
    setup([], []);

    expect(screen.getByText("Add a store first.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Ingredients" })).not.toBeInTheDocument();
  });
});
