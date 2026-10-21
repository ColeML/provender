// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ListSettingRow,
  SettingRow,
  SettingRows,
  type RowSetting,
  type SettingRowData,
} from "./setting-rows";

const mutations = vi.hoisted(() => ({
  set: vi.fn<(input: { key: string; value: string }) => Promise<void>>(),
  delete: vi.fn<(input: { key: string }) => Promise<void>>(),
}));

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    config: {
      set: { mutationOptions: () => mutations.set },
      delete: { mutationOptions: () => mutations.delete },
    },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (mutateAsync: unknown) => ({ mutateAsync }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

afterEach(() => {
  cleanup();
  mutations.set.mockReset();
  mutations.delete.mockReset();
});

const people: RowSetting = { key: "people", label: "Servings per meal", kind: "count" };
const budget: RowSetting = { key: "default_budget", label: "Weekly budget", kind: "money" };
const notes: RowSetting = { key: "preferences", label: "Notes for the planner", kind: "longText" };

function setup(setting: RowSetting, value: string | undefined) {
  const onSave = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
  const user = userEvent.setup();

  render(
    <ul>
      <SettingRow setting={setting} value={value} onSave={onSave} />
    </ul>,
  );

  return { user, onSave };
}

describe("SettingRow", () => {
  it("reads Not set in muted text when the setting has no value", () => {
    setup(people, undefined);

    expect(screen.getByText("Not set")).toHaveClass("text-muted-foreground");
  });

  it("shows the default for a setting that has one", () => {
    setup({ ...people, key: "no_repeat_days", fallback: "30 days (default)" }, undefined);

    expect(screen.getByText("30 days (default)")).toHaveClass("text-muted-foreground");
  });

  it("shows money with a dollar sign", () => {
    setup(budget, "120");

    expect(screen.getByText("$120")).toBeInTheDocument();
  });

  it("does not double the sign on a value stored with one", () => {
    setup(budget, "$120");

    expect(screen.getByText("$120")).toBeInTheDocument();
  });

  it("saves only the edited value and closes the form", async () => {
    const { user, onSave } = setup(people, "4");

    await user.click(screen.getByRole("button", { name: "Edit Servings per meal" }));
    const field = screen.getByRole("textbox", { name: "Servings per meal" });

    expect(field).toHaveValue("4");
    expect(field).toHaveAttribute("inputmode", "numeric");

    await user.clear(field);
    await user.type(field, " 6 ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith("6");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Servings per meal" })).toHaveFocus();
  });

  it("closes without saving on Cancel", async () => {
    const { user, onSave } = setup(people, "4");

    await user.click(screen.getByRole("button", { name: "Edit Servings per meal" }));
    await user.type(screen.getByRole("textbox"), "0");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("keeps what was typed and shows the server's message when the save fails", async () => {
    const { user, onSave } = setup(budget, "120");

    onSave.mockRejectedValueOnce(new Error("Weekly budget must be an amount above zero."));

    await user.click(screen.getByRole("button", { name: "Edit Weekly budget" }));
    const field = screen.getByRole("textbox", { name: "Weekly budget" });

    expect(field).toHaveAttribute("inputmode", "decimal");

    await user.clear(field);
    await user.type(field, "$90");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Weekly budget must be an amount above zero.",
    );
    expect(field).toHaveValue("$90");
  });

  it("edits long text in a textarea", async () => {
    const { user } = setup(notes, "Quick weeknights");

    await user.click(screen.getByRole("button", { name: "Edit Notes for the planner" }));

    expect(screen.getByRole("textbox", { name: "Notes for the planner" }).tagName).toBe("TEXTAREA");
  });

  it("saves an empty field as a clear", async () => {
    const { user, onSave } = setup(people, "4");

    await user.click(screen.getByRole("button", { name: "Edit Servings per meal" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith("");
  });
});

describe("SettingRows", () => {
  const raw = (key: string, value: string): SettingRowData => ({
    setting: { key, label: key, kind: "text" },
    value,
    raw: true,
  });
  const rows = [raw("a", "1"), raw("b", "2"), raw("c", "3")];

  async function clearRow(user: ReturnType<typeof userEvent.setup>, key: string) {
    await user.click(screen.getByRole("button", { name: `Edit ${key}` }));
    await user.clear(screen.getByRole("textbox"));
    await user.click(screen.getByRole("button", { name: "Save" }));
  }

  it("sends a value to config.set and an empty field to config.delete", async () => {
    const user = userEvent.setup();

    render(<SettingRows rows={rows} />);

    await user.click(screen.getByRole("button", { name: "Edit a" }));
    await user.type(screen.getByRole("textbox"), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await clearRow(user, "b");

    expect(mutations.set).toHaveBeenCalledWith({ key: "a", value: "10" });
    expect(mutations.delete).toHaveBeenCalledWith({ key: "b" });
  });

  it("moves focus to the next row when a cleared row leaves the list", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SettingRows rows={rows} />);

    await clearRow(user, "b");
    rerender(<SettingRows rows={[rows[0], rows[2]]} />);

    expect(screen.getByRole("button", { name: "Edit c" })).toHaveFocus();
  });

  it("moves focus to the previous row when the last row is cleared", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SettingRows rows={rows} />);

    await clearRow(user, "c");
    rerender(<SettingRows rows={[rows[0], rows[1]]} />);

    expect(screen.getByRole("button", { name: "Edit b" })).toHaveFocus();
  });

  it("focuses the given element when clearing the only row takes the list away", async () => {
    const user = userEvent.setup();
    const heading = (
      <h2 id="appearance-heading" tabIndex={-1}>
        Appearance
      </h2>
    );
    const { rerender } = render(
      <>
        {heading}
        <SettingRows rows={[rows[0]]} focusWhenEmpty="appearance-heading" />
      </>,
    );

    await clearRow(user, "a");
    rerender(heading);

    expect(screen.getByRole("heading", { name: "Appearance" })).toHaveFocus();
  });
});

const equipment: RowSetting = {
  key: "equipment",
  label: "Equipment",
  kind: "list",
  placeholder: "Instant Pot, sheet pans",
};

function setupList(value: string | undefined, setting = equipment) {
  const onSave = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
  const user = userEvent.setup();

  const view = render(
    <ul>
      <ListSettingRow setting={setting} value={value} onSave={onSave} />
    </ul>,
  );

  return { user, onSave, ...view };
}

function items() {
  return within(screen.getByRole("list", { name: "Equipment" }))
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

async function add(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole("button", { name: "Add to equipment" }));
  await user.type(screen.getByRole("textbox", { name: "Equipment" }), text);
  await user.click(screen.getByRole("button", { name: "Save" }));
}

describe("ListSettingRow", () => {
  it("shows one row per stored item, trimmed and without blanks", () => {
    setupList("oven,  stovetop, , Instant Pot");

    expect(items()).toEqual(["oven", "stovetop", "Instant Pot"]);
  });

  it("reads None in muted text when the list has no items", () => {
    setupList(undefined);

    expect(screen.getByText("None")).toHaveClass("text-muted-foreground");
    expect(screen.queryByRole("list", { name: "Equipment" })).not.toBeInTheDocument();
  });

  it("saves the list without the deleted item", async () => {
    const { user, onSave } = setupList("oven, stovetop, Instant Pot");

    await user.click(screen.getByRole("button", { name: "Remove stovetop from equipment" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith("oven, Instant Pot");
  });

  it("clears the setting when the last item is deleted", async () => {
    const { user, onSave } = setupList("oven");

    await user.click(screen.getByRole("button", { name: "Remove oven from equipment" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith("");
  });

  it("moves focus to the next item's delete button after a delete", async () => {
    const { user, rerender, onSave } = setupList("oven, stovetop, Instant Pot");

    await user.click(screen.getByRole("button", { name: "Remove stovetop from equipment" }));
    rerender(
      <ul>
        <ListSettingRow setting={equipment} value="oven, Instant Pot" onSave={onSave} />
      </ul>,
    );

    expect(screen.getByRole("button", { name: "Remove Instant Pot from equipment" })).toHaveFocus();
  });

  it("moves focus to the previous item when the bottom one is deleted", async () => {
    const { user, rerender, onSave } = setupList("oven, stovetop");

    await user.click(screen.getByRole("button", { name: "Remove stovetop from equipment" }));
    rerender(
      <ul>
        <ListSettingRow setting={equipment} value="oven" onSave={onSave} />
      </ul>,
    );

    expect(screen.getByRole("button", { name: "Remove oven from equipment" })).toHaveFocus();
  });

  it("moves focus to Add when the last item is deleted", async () => {
    const { user, rerender, onSave } = setupList("oven");

    await user.click(screen.getByRole("button", { name: "Remove oven from equipment" }));
    rerender(
      <ul>
        <ListSettingRow setting={equipment} value={undefined} onSave={onSave} />
      </ul>,
    );

    expect(screen.getByRole("button", { name: "Add to equipment" })).toHaveFocus();
  });

  it("says so and keeps the item when a delete fails", async () => {
    const { user, onSave } = setupList("oven, stovetop");

    onSave.mockRejectedValueOnce(new Error("Could not save Equipment. Try again."));
    await user.click(screen.getByRole("button", { name: "Remove oven from equipment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not deleted — try again");
    expect(screen.getByRole("button", { name: "Remove oven from equipment" })).toBeEnabled();
  });

  it("adds one item to the end", async () => {
    const { user, onSave } = setupList("oven");

    await add(user, "  air fryer ");

    expect(onSave).toHaveBeenCalledExactlyOnceWith("oven, air fryer");
  });

  it("adds several comma-separated items, dropping blanks and repeats", async () => {
    const { user, onSave } = setupList("oven, Instant Pot");

    await add(user, "sheet pans, , instant pot, Dutch oven, sheet pans");

    expect(onSave).toHaveBeenCalledExactlyOnceWith("oven, Instant Pot, sheet pans, Dutch oven");
  });

  it("starts the list when the setting is unset", async () => {
    const { user, onSave } = setupList(undefined);

    await add(user, "oven, stovetop");

    expect(onSave).toHaveBeenCalledExactlyOnceWith("oven, stovetop");
  });

  it("closes without saving when every item is already in the list", async () => {
    const { user, onSave } = setupList("oven, Instant Pot");

    await add(user, "OVEN, instant pot");

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to equipment" })).toHaveFocus();
  });

  it("folds the field away after a save and returns focus to Add", async () => {
    const { user } = setupList("oven");

    await add(user, "wok");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to equipment" })).toHaveFocus();
  });

  it("folds the field away without saving on Cancel", async () => {
    const { user, onSave } = setupList("oven");

    await user.click(screen.getByRole("button", { name: "Add to equipment" }));
    await user.type(screen.getByRole("textbox", { name: "Equipment" }), "wok");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to equipment" })).toHaveFocus();
  });

  it("keeps what was typed and shows the message when an add fails", async () => {
    const { user, onSave } = setupList("oven");

    onSave.mockRejectedValueOnce(new Error("Could not save Equipment. Try again."));
    await add(user, "wok");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save Equipment. Try again.",
    );
    expect(screen.getByRole("textbox", { name: "Equipment" })).toHaveValue("wok");
  });

  it("shows the setting's hint in the add field", async () => {
    const { user } = setupList(undefined, {
      ...equipment,
      hint: "Marked as already on hand when the shopping list is built.",
    });

    await user.click(screen.getByRole("button", { name: "Add to equipment" }));

    expect(screen.getByRole("textbox", { name: "Equipment" })).toHaveAccessibleDescription(
      "Marked as already on hand when the shopping list is built.",
    );
  });

  it("ignores another delete while a save is in flight", async () => {
    const { user, onSave } = setupList("oven, stovetop");

    const { promise, resolve } = Promise.withResolvers<void>();

    onSave.mockReturnValueOnce(promise);
    await user.click(screen.getByRole("button", { name: "Remove oven from equipment" }));
    await user.click(screen.getByRole("button", { name: "Remove stovetop from equipment" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith("stovetop");

    // React holds every async transition pending until all of them settle, so an unsettled one
    // would leak into the next test.
    resolve();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove oven from equipment" })).toHaveAttribute(
        "aria-disabled",
        "false",
      ),
    );
  });
});

describe("SettingRows with a list setting", () => {
  it("saves a shorter list with config.set and an emptied one with config.delete", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SettingRows rows={[{ setting: equipment, value: "oven, wok" }]} />,
    );

    await user.click(screen.getByRole("button", { name: "Remove wok from equipment" }));
    rerender(<SettingRows rows={[{ setting: equipment, value: "oven" }]} />);
    const oven = screen.getByRole("button", { name: "Remove oven from equipment" });

    await waitFor(() => expect(oven).toHaveAttribute("aria-disabled", "false"));
    await user.click(oven);

    expect(mutations.set).toHaveBeenCalledWith({ key: "equipment", value: "oven" });
    expect(mutations.delete).toHaveBeenCalledWith({ key: "equipment" });
  });
});
