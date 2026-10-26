import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { FIELD } from "@/components/ui/field";
import { LogoMark } from "@/components/ui/logo-mark";
import { Verse } from "@/components/ui/verse";
import { Wordmark } from "@/components/ui/wordmark";
import { isInternalPath } from "@/lib/login-url";

import { signIn } from "../../../auth";
import { SubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ from?: string; error?: string }>;
}

export default async function Login({ searchParams }: Props) {
  const { from, error } = await searchParams;

  async function authenticate(formData: FormData) {
    "use server";

    const target = typeof from === "string" && isInternalPath(from) ? from : "/";

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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col p-8">
      <div className="my-auto">
        <header className="flex flex-col items-center border-y py-8 text-center">
          <LogoMark height={96} loading="eager" className="mb-4 rounded-2xl dark:p-2" />
          <h1 className="text-2xl">
            <Wordmark />
          </h1>
          {error ? (
            <p id="login-error" role="alert" className="text-destructive mt-1 text-sm">
              That password is not right.
            </p>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">Enter the household password.</p>
          )}
        </header>

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
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
            className={FIELD}
          />

          <SubmitButton />
        </form>
      </div>

      <footer className="mt-12 text-center">
        <Verse reference="Psalm 111:5" />
      </footer>
    </main>
  );
}
