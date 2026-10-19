// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingRow, SettingRows, type RowSetting, type SettingRowData } from "./setting-rows";

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
