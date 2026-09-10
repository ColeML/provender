import Link from "next/link";

const SURFACES = [
  { href: "/plan", label: "Plan" },
  { href: "/shop", label: "Shop" },
  { href: "/recipes", label: "Recipes" },
  { href: "/settings", label: "Settings" },
];

/**
 * The signed-in shell. `/login` sits outside this group, so it never renders the nav.
 *
 * The header deliberately does not stick. `/shop` is used one-handed in an aisle, where every row
 * of screen is a row of list, and its aisle headings already own `top-0`.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-border border-b">
        <nav className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Provender
          </Link>

          <span className="flex-1" />

          {SURFACES.map((surface) => (
            <Link
              key={surface.href}
              href={surface.href}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              {surface.label}
            </Link>
          ))}
        </nav>
      </header>

      {children}
    </>
  );
}
