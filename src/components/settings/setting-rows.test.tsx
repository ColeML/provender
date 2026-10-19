// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingRow, type RowSetting } from "./setting-rows";

afterEach(cleanup);

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

  it("will not save an empty field", async () => {
    const { user, onSave } = setup(people, "4");

    await user.click(screen.getByRole("button", { name: "Edit Servings per meal" }));
    await user.clear(screen.getByRole("textbox"));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
