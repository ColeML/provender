// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SharedDay, type SharedDayView } from "./shared-day";

const day: SharedDayView = {
  date: "2026-09-07",
  meals: [
    {
      mealSlot: "breakfast",
      notes: null,
      dishes: [
        {
          role: "Main",
          title: "Baked Oatmeal",
          baseServings: 8,
          totalMin: null,
          instructions: [],
          ingredients: [],
        },
      ],
    },
    {
      mealSlot: "dinner",
      notes: "Bedtime at 8.",
      dishes: [
        {
          role: "Main",
          title: "Chicken Fajitas",
          baseServings: 8,
          totalMin: 40,
          instructions: ["Slice {3|bell pepper} peppers."],
          ingredients: [{ id: "a", name: "bell pepper", quantity: 3, unit: "ea", notes: null }],
        },
        {
          role: "Side",
          title: "Cilantro Lime Rice",
          baseServings: 6,
          totalMin: 25,
          instructions: ["Cook the rice."],
          ingredients: [{ id: "b", name: "rice", quantity: 1.5, unit: "cup", notes: null }],
        },
      ],
    },
  ],
};

describe("SharedDay", () => {
  it("names the day", () => {
    render(<SharedDay day={day} />);

    expect(screen.getByRole("heading", { level: 1, name: "Monday" })).toBeInTheDocument();
    expect(screen.getByText("September 7, 2026")).toBeInTheDocument();
  });

  it("shows each meal in order, with its notes and every dish's recipe as stored", () => {
    render(<SharedDay day={day} />);

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Breakfast",
      "Dinner",
    ]);

    const dinner = screen.getByRole("region", { name: "Dinner" });

    expect(within(dinner).getByText("Bedtime at 8.")).toBeInTheDocument();
    expect(
      within(dinner).getByRole("heading", { level: 3, name: /Chicken Fajitas/ }),
    ).toBeVisible();
    expect(
      within(dinner).getByRole("heading", { level: 3, name: /Cilantro Lime Rice/ }),
    ).toBeVisible();

    const [fajitas, rice] = within(dinner).getAllByRole("list", { name: "Ingredients" });

    expect(fajitas).toHaveTextContent("3 ea");
    expect(rice).toHaveTextContent("1½ cup");
    expect(within(dinner).getAllByRole("list", { name: "Method" })[0]).toHaveTextContent(
      "Slice 3 peppers.",
    );
  });

  it("shows no forecast and no link into the app", () => {
    const { container } = render(<SharedDay day={day} />);

    expect(screen.queryByText("Forecast")).not.toBeInTheDocument();
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("says nothing is planned for a day with no meals", () => {
    render(<SharedDay day={{ date: "2026-09-07", meals: [] }} />);

    expect(screen.getByText("Nothing planned")).toBeInTheDocument();
  });
});
