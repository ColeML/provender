import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn } from "../../../auth";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ from?: string; error?: string }>;
}

export default async function Login({ searchParams }: Props) {
  const { from, error } = await searchParams;

  async function authenticate(formData: FormData) {
    "use server";

    const target = typeof from === "string" && from.startsWith("/") ? from : "/";

    try {
      await signIn("credentials", {
        password: formData.get("password"),
        redirectTo: target,
      });
    } catch (caught) {
      // signIn throws a redirect on success, so only a real auth failure is handled here —
      // rethrowing anything else keeps the redirect working.
      if (caught instanceof AuthError) {
        redirect(`/login?error=1${from ? `&from=${encodeURIComponent(from)}` : ""}`);
      }

      throw caught;
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
      <h1 className="font-display text-2xl font-semibold">Provender</h1>
      <p className="text-muted-foreground mt-1 text-sm">Enter the household password.</p>

      <form action={authenticate} className="mt-8 flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="border-border bg-background focus-visible:ring-ring h-11 rounded-lg border px-3 text-base focus-visible:ring-3 focus-visible:outline-none"
        />

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            That password is not right.
          </p>
        ) : null}

        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-2 h-11 rounded-lg text-sm font-medium"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
