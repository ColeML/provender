// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteForm } from "./add-note";

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

function setup(onAdd = vi.fn<(note: { date: string | null; body: string }) => Promise<void>>()) {
  onAdd.mockResolvedValue();

  const user = userEvent.setup();

  render(<NoteForm dates={W42} onAdd={onAdd} />);

  return { user, onAdd };
}

describe("NoteForm", () => {
  it("saves the typed note on Enter, for any day by default", async () => {
    const { user, onAdd } = setup();

    await user.type(
      screen.getByRole("textbox", { name: "Note" }),
      "Mom asked for pot roast{Enter}",
    );

    expect(onAdd).toHaveBeenCalledWith({ date: null, body: "Mom asked for pot roast" });
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("");
  });

  it("offers any day and only the week's seven days", () => {
    setup();

    const options = within(screen.getByRole("combobox", { name: "Day" })).getAllByRole("option");

    expect(options.map((option) => option.textContent)).toEqual([
      "Any day",
      "Mon 12",
      "Tue 13",
      "Wed 14",
      "Thu 15",
      "Fri 16",
      "Sat 17",
      "Sun 18",
    ]);
    expect(screen.getByRole("combobox", { name: "Day" })).toHaveValue("");
  });

  it("saves a note against the chosen day, then resets the day", async () => {
    const { user, onAdd } = setup();

    await user.selectOptions(screen.getByRole("combobox", { name: "Day" }), "Thu 15");
    await user.type(screen.getByRole("textbox", { name: "Note" }), "Soccer until 7");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledWith({ date: "2026-10-15", body: "Soccer until 7" });
    expect(screen.getByRole("combobox", { name: "Day" })).toHaveValue("");
  });

  it("does not save a blank note", async () => {
    const { user, onAdd } = setup();

    await user.type(screen.getByRole("textbox", { name: "Note" }), "   {Enter}");

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("keeps what was typed while the previous note was still saving", async () => {
    const onAdd = vi.fn<(note: { date: string | null; body: string }) => Promise<void>>();
    const saved = Promise.withResolvers<void>();
    const user = userEvent.setup();

    onAdd.mockReturnValue(saved.promise);
    render(<NoteForm dates={W42} onAdd={onAdd} />);

    const note = screen.getByRole("textbox", { name: "Note" });

    await user.type(note, "Pot roast{Enter}");
    await user.clear(note);
    await user.type(note, "Soccer{Enter}");
    await user.selectOptions(screen.getByRole("combobox", { name: "Day" }), "Thu 15");

    saved.resolve();

    await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled());
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(note).toHaveValue("Soccer");
    expect(screen.getByRole("combobox", { name: "Day" })).toHaveValue("2026-10-15");
  });

  // The day belongs to the note being typed, so it is kept with that note, not reset on its own.
  it("keeps the day with a note typed while the previous one was saving", async () => {
    const onAdd = vi.fn<(note: { date: string | null; body: string }) => Promise<void>>();
    const saved = Promise.withResolvers<void>();
    const user = userEvent.setup();

    onAdd.mockReturnValue(saved.promise);
    render(<NoteForm dates={W42} onAdd={onAdd} />);

    const note = screen.getByRole("textbox", { name: "Note" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Day" }), "Thu 15");
    await user.type(note, "Soccer{Enter}");
    await user.clear(note);
    await user.type(note, "Pizza night");

    saved.resolve();

    await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled());
    expect(note).toHaveValue("Pizza night");
    expect(screen.getByRole("combobox", { name: "Day" })).toHaveValue("2026-10-15");
  });

  // The note is the household's words; a failed write must not throw them away.
  it("keeps the note and says so when saving fails", async () => {
    const onAdd = vi.fn<(note: { date: string | null; body: string }) => Promise<void>>();
    const user = userEvent.setup();

    onAdd.mockRejectedValue(new Error("offline"));
    render(<NoteForm dates={W42} onAdd={onAdd} />);

    await user.type(screen.getByRole("textbox", { name: "Note" }), "Pot roast{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save that note.");
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("Pot roast");
  });
});
