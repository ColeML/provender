import Image from "next/image";

import { cn } from "@/lib/utils";

/** The pixel size of `public/logo-mark.png`, which `scripts/render-icons` writes. */
export const LOGO_MARK_SIZE = { width: 238, height: 288 };

/**
 * The logo's mark, for `/login` and the shared recipe page.
 *
 * Its alt text is empty because the `Wordmark` beside it already names the app. In dark mode it
 * sits on a parchment tile: on the dark ground its teal loses contrast and its white details,
 * which are transparent in the image, turn dark.
 */
export function LogoMark({ height, className }: { height: number; className?: string }) {
  return (
    <Image
      src="/logo-mark.png"
      alt=""
      width={Math.round((height * LOGO_MARK_SIZE.width) / LOGO_MARK_SIZE.height)}
      height={height}
      className={cn("dark:bg-foreground box-content", className)}
    />
  );
}
