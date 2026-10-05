// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteItem, type NoteChange } from "./note-item";

const W42 = [
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
];

afterEach(cleanup);

function setup({
  body = "Socer until 7",
  date = "2026-10-15" as string | null,
  onSave = vi.fn<(change: NoteChange) => Promise<void>>().mockResolvedValue(),
  onDelete = vi.fn<() => Promise<void>>().mockResolvedValue(),
} = {}) {
  const user = userEvent.setup();

  render(
    <>
      <NoteItem
        id="note-1"
        body={body}
        date={date}
        dates={W42}
        onSave={onSave}
        onDelete={onDelete}
      />
      <button type="button">Elsewhere</button>
    </>,
  );

  return { user, onSave, onDelete };
}

function editor() {
  const form = screen.getByRole("form", { name: "Edit note" });

  return {
    note: within(form).getByRole("textbox", { name: "Note" }),
    day: within(form).getByRole("combobox", { name: "Day" }),
  };
}

describe("NoteItem", () => {
  it("opens the note for editing when tapped, with its text and day", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));

    expect(editor().note).toHaveValue("Socer until 7");
    expect(editor().note).toHaveFocus();
    expect(editor().day).toHaveValue("2026-10-15");
  });

  it("saves the edited text on Enter and closes", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.clear(editor().note);
    await user.type(editor().note, "Soccer until 7{Enter}");

    expect(onSave).toHaveBeenCalledWith({ body: "Soccer until 7" });
    expect(screen.queryByRole("form", { name: "Edit note" })).toBeNull();
  });

  it("saves when focus leaves the note", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.type(editor().note, "!");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(onSave).toHaveBeenCalledWith({ body: "Socer until 7!" });
  });

  it("does not save when focus moves from the text to the day", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.tab();

    expect(editor().day).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("moves the note to another day, then saves it on leaving", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.selectOptions(editor().day, "Fri 16");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(onSave).toHaveBeenCalledWith({ date: "2026-10-16" });
  });

  it("moves the note to any day", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.selectOptions(editor().day, "Any day");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(onSave).toHaveBeenCalledWith({ date: null });
  });

  it("offers any day and only the week's seven days", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));

    expect(
      within(editor().day)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Any day", "Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16", "Sat 17", "Sun 18"]);
  });

  it("cancels on Escape, keeping the note as it was", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.type(editor().note, " typo");
    await user.keyboard("{Escape}");

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Edit note" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit note: Socer until 7" })).toBeInTheDocument();
  });

  it("keeps the previous text when the edit is saved blank", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.clear(editor().note);
    await user.type(editor().note, "   {Enter}");

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit note: Socer until 7" })).toBeInTheDocument();
  });

  it("saves a new day with a blank edit, but not the blank text", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.clear(editor().note);
    await user.selectOptions(editor().day, "Sat 17");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(onSave).toHaveBeenCalledWith({ date: "2026-10-17" });
  });

  it("saves nothing when nothing changed", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.keyboard("{Enter}");

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Edit note" })).toBeNull();
  });

  // The edit is the household's words; a failed write must not throw them away.
  it("keeps the edit open and says so when saving fails", async () => {
    const onSave = vi.fn<(change: NoteChange) => Promise<void>>();

    onSave.mockRejectedValue(new Error("offline"));

    const { user } = setup({ onSave });

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.type(editor().note, "!{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save that note.");
    expect(editor().note).toHaveValue("Socer until 7!");
  });

  // Without this, focus falls to the page and the next Tab starts again from the header.
  it.each([
    { closing: "Escape", keys: " typo{Escape}" },
    { closing: "Enter with no change", keys: "{Enter}" },
    { closing: "Enter after a save", keys: "!{Enter}" },
  ])("returns focus to the note after $closing", async ({ keys }) => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.type(editor().note, keys);

    expect(await screen.findByRole("button", { name: /^Edit note: / })).toHaveFocus();
  });

  it("leaves focus where it went when the edit is saved by leaving", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.type(editor().note, "!");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("leaves focus alone when it moved on while the save was in flight", async () => {
    const onSave = vi.fn<(change: NoteChange) => Promise<void>>();
    const saved = Promise.withResolvers<void>();

    onSave.mockReturnValue(saved.promise);

    const { user } = setup({ onSave });

    await user.click(screen.getByRole("button", { name: "Edit note: Socer until 7" }));
    await user.type(editor().note, "!{Enter}");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    saved.resolve();

    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit note" })).toBeNull());
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("deletes the note from its delete control", async () => {
    const { user, onDelete } = setup();

    await user.click(screen.getByRole("button", { name: "Delete note: Socer until 7" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("says so when deleting fails", async () => {
    const onDelete = vi.fn<() => Promise<void>>();

    onDelete.mockRejectedValue(new Error("offline"));

    const { user } = setup({ onDelete });

    await user.click(screen.getByRole("button", { name: "Delete note: Socer until 7" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete that note.");
    expect(screen.getByRole("button", { name: "Edit note: Socer until 7" })).toBeInTheDocument();
  });
});
