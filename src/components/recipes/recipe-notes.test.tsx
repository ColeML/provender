// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteList, RecipeNotes } from "./recipe-notes";

const setNotes = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    recipes: { setNotes: { mutationOptions: () => ({ mutationFn: setNotes }) } },
  }),
}));

const NOTES = ["Use a rotisserie chicken", "Double the sauce"];

function setup(notes: string[] = NOTES) {
  const user = userEvent.setup();
  const onSave = vi.fn<(next: string[]) => Promise<void>>().mockResolvedValue(undefined);
  const view = render(<NoteList notes={notes} onSave={onSave} />);

  return {
    user,
    onSave,
    rerender: (next: string[]) => view.rerender(<NoteList notes={next} onSave={onSave} />),
  };
}

function note(text: string) {
  return within(screen.getByRole("list", { name: "Notes" })).getByRole("button", { name: text });
}

function longPress(element: HTMLElement) {
  vi.useFakeTimers();

  try {
    fireEvent.pointerDown(element, { button: 0, pointerType: "touch", clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  cleanup();
});

describe("NoteList", () => {
  it("shows one row per note, keeping line breaks", () => {
    setup(["Use a rotisserie chicken", "Sear in batches.\nDon't crowd the pan."]);

    const rows = within(screen.getByRole("list", { name: "Notes" })).getAllByRole("listitem");

    expect(rows).toHaveLength(2);

    const multiline = within(rows[1]).getByRole("button", { name: /^Sear in batches/ });

    expect(multiline.textContent).toBe("Sear in batches.\nDon't crowd the pan.");
    expect(multiline).toHaveClass("whitespace-pre-line");
  });

  it("reads 'No notes' with no notes, and still offers + Add", () => {
    setup([]);

    expect(screen.getByText("No notes")).toHaveClass("text-muted-foreground");
    expect(screen.queryByRole("list", { name: "Notes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a note" })).toBeInTheDocument();
  });

  it("tells a screen reader how to edit a note", () => {
    setup();

    expect(note("Use a rotisserie chicken")).toHaveAccessibleDescription(
      "Long press or press Enter to edit.",
    );
  });

  it("adds a note from + Add, at the end, without splitting on commas", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Add a note" }));
    await user.type(screen.getByRole("textbox", { name: "New note" }), "Salt, then pepper");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith([...NOTES, "Salt, then pepper"]);
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "New note" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Add a note" })).toHaveFocus();
  });

  it("puts a line break in the note on Enter instead of saving", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Add a note" }));
    await user.type(
      screen.getByRole("textbox", { name: "New note" }),
      "Sear in batches.{Enter}Rest",
    );

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "New note" })).toHaveValue("Sear in batches.\nRest");
  });

  it("closes the add form without saving when the note is blank", async () => {
    const { user, onSave } = setup();

    await user.click(screen.getByRole("button", { name: "Add a note" }));
    await user.type(screen.getByRole("textbox", { name: "New note" }), "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "New note" })).not.toBeInTheDocument();
  });

  it("keeps what was typed and shows an alert when adding fails", async () => {
    const { user, onSave } = setup();

    onSave.mockRejectedValueOnce(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "Add a note" }));
    await user.type(screen.getByRole("textbox", { name: "New note" }), "Warm the tortillas");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save that note. Try again.",
    );
    expect(screen.getByRole("textbox", { name: "New note" })).toHaveValue("Warm the tortillas");
  });

  it("deletes a note and focuses the next row", async () => {
    const { user, onSave, rerender } = setup();

    await user.click(screen.getByRole("button", { name: "Remove note: Use a rotisserie chicken" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith(["Double the sauce"]);

    rerender(["Double the sauce"]);

    expect(note("Double the sauce")).toHaveFocus();
  });

  it("focuses the previous row when the bottom note is deleted, and + Add after the last", async () => {
    const { user, rerender } = setup();

    await user.click(screen.getByRole("button", { name: "Remove note: Double the sauce" }));
    rerender(["Use a rotisserie chicken"]);

    expect(note("Use a rotisserie chicken")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Remove note: Use a rotisserie chicken" }));
    rerender([]);

    expect(screen.getByRole("button", { name: "Add a note" })).toHaveFocus();
  });

  it("names a long note by its first 40 characters on the delete button", () => {
    setup(["Brown the beef in two batches so it sears instead of steaming"]);

    expect(
      screen.getByRole("button", {
        name: "Remove note: Brown the beef in two batches so it sear…",
      }),
    ).toBeInTheDocument();
  });

  it("takes no second change while the first is still saving", async () => {
    const { user, onSave } = setup();
    let finish = () => {};

    onSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole("button", { name: "Remove note: Use a rotisserie chicken" }));
    await user.click(screen.getByRole("button", { name: "Remove note: Double the sauce" }));

    expect(onSave).toHaveBeenCalledOnce();

    await act(async () => {
      finish();
    });
    await user.click(screen.getByRole("button", { name: "Remove note: Double the sauce" }));

    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("closes an open edit when another note is deleted, since the rows shift", async () => {
    const { user, onSave, rerender } = setup(["First", "Second", "Third"]);

    longPress(note("Third"));
    await user.click(screen.getByRole("button", { name: "Remove note: First" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith(["Second", "Third"]);
    expect(screen.queryByRole("textbox", { name: "Edit note" })).not.toBeInTheDocument();

    rerender(["Second", "Third"]);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("says 'Not deleted — try again' under the row when deleting fails", async () => {
    const { user, onSave } = setup();

    onSave.mockRejectedValueOnce(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "Remove note: Use a rotisserie chicken" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not deleted — try again");
    expect(note("Use a rotisserie chicken")).toBeInTheDocument();
  });

  it("opens a note for editing on a long press, with its text and the cursor at the end", () => {
    setup();

    longPress(note("Double the sauce"));

    const field = screen.getByRole("textbox", { name: "Edit note" });

    expect(field).toHaveValue("Double the sauce");
    expect(field).toHaveFocus();
    expect(field).toHaveProperty("selectionStart", "Double the sauce".length);
  });

  it("does not open a note on a tap", async () => {
    const { user } = setup();

    await user.click(note("Double the sauce"));

    expect(screen.queryByRole("textbox", { name: "Edit note" })).not.toBeInTheDocument();
  });

  it("opens a note for editing with Enter", async () => {
    const { user } = setup();

    note("Double the sauce").focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("textbox", { name: "Edit note" })).toHaveValue("Double the sauce");
  });

  it("saves an edit in place", async () => {
    const { user, onSave } = setup();

    longPress(note("Double the sauce"));
    await user.clear(screen.getByRole("textbox", { name: "Edit note" }));
    await user.type(screen.getByRole("textbox", { name: "Edit note" }), "Triple the sauce");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith([
      "Use a rotisserie chicken",
      "Triple the sauce",
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Edit note" })).not.toBeInTheDocument(),
    );
  });

  it("closes without saving when the edit is unchanged", async () => {
    const { user, onSave } = setup();

    longPress(note("Double the sauce"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Edit note" })).not.toBeInTheDocument();
  });

  it("closes without saving, keeping the old text, when the edit is blank", async () => {
    const { user, onSave } = setup();

    longPress(note("Double the sauce"));
    await user.clear(screen.getByRole("textbox", { name: "Edit note" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(note("Double the sauce")).toBeInTheDocument();
  });

  it("closes on Escape without saving and returns focus to the note", async () => {
    const { user, onSave } = setup();

    note("Double the sauce").focus();
    await user.keyboard("{Enter}");
    await user.type(screen.getByRole("textbox", { name: "Edit note" }), " twice");
    await user.keyboard("{Escape}");

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Edit note" })).not.toBeInTheDocument();
    expect(note("Double the sauce")).toHaveFocus();
  });

  it("returns focus to the note on Cancel", async () => {
    const { user } = setup();

    longPress(note("Double the sauce"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(note("Double the sauce")).toHaveFocus();
  });

  it("keeps the draft and shows an alert when the edit fails", async () => {
    const { user, onSave } = setup();

    onSave.mockRejectedValueOnce(new Error("offline"));
    longPress(note("Double the sauce"));
    await user.type(screen.getByRole("textbox", { name: "Edit note" }), " twice");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save that note. Try again.",
    );
    expect(screen.getByRole("textbox", { name: "Edit note" })).toHaveValue(
      "Double the sauce twice",
    );
  });

  it("closes the add form when a note is opened, and the other way round", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Add a note" }));
    await user.type(screen.getByRole("textbox", { name: "New note" }), "Dropped");
    longPress(note("Double the sauce"));

    expect(screen.queryByRole("textbox", { name: "New note" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Edit note" })).toHaveValue("Double the sauce");

    await user.click(screen.getByRole("button", { name: "Add a note" }));

    expect(screen.queryByRole("textbox", { name: "Edit note" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New note" })).toHaveValue("");
  });

  it("opening one note closes another's edit", async () => {
    const { user } = setup();

    longPress(note("Double the sauce"));
    await user.type(screen.getByRole("textbox", { name: "Edit note" }), " twice");
    longPress(note("Use a rotisserie chicken"));

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Edit note" })).toHaveValue(
      "Use a rotisserie chicken",
    );
  });
});

describe("RecipeNotes", () => {
  it("saves the whole list for its recipe, then refreshes the page", async () => {
    const user = userEvent.setup();

    setNotes.mockReset().mockResolvedValue({});
    refresh.mockReset();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecipeNotes recipeId="fajitas" notes={["Warm the tortillas"]} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add a note" }));
    await user.type(screen.getByRole("textbox", { name: "New note" }), "Double the sauce");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setNotes.mock.calls[0][0]).toEqual({
      recipeId: "fajitas",
      notes: ["Warm the tortillas", "Double the sauce"],
    });
  });
});
