import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import {
  addWeekNote,
  BlankNoteError,
  DateOutsideWeekError,
  deleteWeekNote,
  InvalidWeekIdError,
  listWeekNotes,
  updateWeekNote,
  WeekNoteNotFoundError,
  type WeekNote,
  type WeekNoteUpdate,
} from "@server/services/week-notes";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

function toResource(note: WeekNote) {
  return {
    name: `weeks/${note.weekId}/notes/${note.id}`,
    noteId: note.id,
    weekId: note.weekId,
    date: note.date,
    body: note.body,
    createTime: note.createTime.toISOString(),
    updateTime: note.updateTime.toISOString(),
  };
}

const WeekNoteSchema = z
  .object({
    name: z.string().openapi({ example: "weeks/2026-W42/notes/0b9c6f0e-..." }),
    noteId: z.string(),
    weekId: z.string().openapi({ example: "2026-W42" }),
    // Null means any day of the week.
    date: z.string().nullable().openapi({ example: "2026-10-15" }),
    body: z.string().openapi({ example: "Soccer until 7" }),
    createTime: z.string(),
    updateTime: z.string(),
  })
  .openapi("WeekNote");

function noteError(c: Parameters<typeof apiError>[0], error: unknown) {
  if (error instanceof WeekNoteNotFoundError) {
    return apiError(c, "NOT_FOUND", error.message);
  }

  if (
    error instanceof InvalidWeekIdError ||
    error instanceof DateOutsideWeekError ||
    error instanceof BlankNoteError
  ) {
    return apiError(c, "INVALID_ARGUMENT", error.message);
  }

  throw error;
}

const WeekParam = z.object({
  week: z
    .string()
    .min(1)
    .openapi({ param: { name: "week", in: "path" }, example: "2026-W42" }),
});

const NoteParam = WeekParam.extend({
  note: z
    .string()
    .min(1)
    .openapi({ param: { name: "note", in: "path" } }),
});

export const weekNotesRoutes = new OpenAPIHono<ApiEnv>();

// No `pageSize`/`pageToken`: a week holds a handful of notes, so there is never a second page.
weekNotesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/weeks/{week}/notes",
    summary: "List the household's notes for a week",
    description:
      "A week here is an ISO week, and need not have a plan — notes are usually written before " +
      "the week is planned. Any-day notes come first, then Monday to Sunday, oldest first.",
    request: { params: WeekParam },
    responses: {
      200: {
        description: "The week's notes, or an empty list",
        content: {
          "application/json": { schema: z.object({ notes: z.array(WeekNoteSchema) }) },
        },
      },
      400: { description: "The week is not an ISO week id" },
    },
  }),
  async (c) => {
    const { week } = c.req.valid("param");

    try {
      const notes = await listWeekNotes(c.get("householdId"), week);

      return c.json({ notes: notes.map(toResource) }, 200);
    } catch (error) {
      return noteError(c, error);
    }
  },
);

weekNotesRoutes.openapi(
  createRoute({
    method: "post",
    path: "/weeks/{week}/notes",
    summary: "Add a note to a week",
    description:
      "The server assigns the id, so a retried request can add the note twice. The duplicate is " +
      "visible in the list and can be deleted.",
    request: {
      params: WeekParam,
      body: {
        content: {
          "application/json": {
            schema: z
              .object({
                date: z.string().nullish().openapi({ description: "Omit for any day" }),
                body: z.string(),
              })
              .openapi("WeekNoteInput", {
                example: { date: "2026-10-15", body: "Soccer until 7" },
              }),
          },
        },
      },
    },
    responses: {
      200: { description: "The note", content: { "application/json": { schema: WeekNoteSchema } } },
      400: { description: "The week is invalid, the date is outside it, or the body is blank" },
    },
  }),
  async (c) => {
    const { week } = c.req.valid("param");

    try {
      const note = await addWeekNote(c.get("householdId"), week, c.req.valid("json"));

      return c.json(toResource(note), 200);
    } catch (error) {
      return noteError(c, error);
    }
  },
);

weekNotesRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/weeks/{week}/notes/{note}",
    summary: "Edit a note's text or day",
    description:
      "A note's week is fixed, so there is no week field. To move a note, delete it and add it " +
      "to the other week. A masked `date` left out of the body clears it to any day.",
    request: {
      params: NoteParam,
      query: z.object({
        updateMask: z
          .string()
          .min(1)
          .openapi({ example: "body,date", description: "Comma-separated field names" }),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ date: z.string().nullish(), body: z.string().optional() }),
          },
        },
      },
    },
    responses: {
      200: { description: "The note", content: { "application/json": { schema: WeekNoteSchema } } },
      400: { description: "The mask, week, date or body is invalid" },
      404: { description: "No such note in this week" },
    },
  }),
  async (c) => {
    const { week, note } = c.req.valid("param");
    const { updateMask } = c.req.valid("query");
    const patch = c.req.valid("json");
    const fields = updateMask
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const unknown = fields.filter((field) => field !== "date" && field !== "body");

    if (fields.length === 0) {
      // An empty mask would update nothing and answer 200, so a client that built the mask from an
      // empty array would read a lost write as a successful one.
      return apiError(c, "INVALID_ARGUMENT", "updateMask names no fields");
    }

    if (unknown.length > 0) {
      return apiError(
        c,
        "INVALID_ARGUMENT",
        `Unknown field(s) in updateMask: ${unknown.join(", ")}`,
      );
    }

    const update: WeekNoteUpdate = {};

    if (fields.includes("date")) {
      update.date = patch.date ?? null;
    }

    if (fields.includes("body")) {
      update.body = patch.body ?? "";
    }

    try {
      return c.json(
        toResource(await updateWeekNote(c.get("householdId"), week, note, update)),
        200,
      );
    } catch (error) {
      return noteError(c, error);
    }
  },
);

weekNotesRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/weeks/{week}/notes/{note}",
    summary: "Delete a note",
    request: { params: NoteParam },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: z.object({}) } } },
      400: { description: "The week is not an ISO week id" },
      404: { description: "No such note in this week" },
    },
  }),
  async (c) => {
    const { week, note } = c.req.valid("param");

    try {
      await deleteWeekNote(c.get("householdId"), week, note);

      return c.json({}, 200);
    } catch (error) {
      return noteError(c, error);
    }
  },
);
