"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match device" },
];

function subscribeToNothing() {
  return () => {};
}

/**
 * Light, dark, or the device's setting, kept on this device by next-themes.
 *
 * The server cannot see the stored choice, so no option is checked until the client has mounted;
 * checking one during the server render would hydrate to a different tree.
 */
export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  return (
    <fieldset>
      <legend className="text-muted-foreground text-xs">Theme</legend>
      <div className="border-border mt-2 flex rounded-lg border p-1">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className="has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-ring flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-md text-sm has-focus-visible:ring-3"
          >
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={mounted && theme === option.value}
              onChange={() => setTheme(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
