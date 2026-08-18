import { sr } from "@/lib/i18n/sr";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ greska?: string }>;
}) {
  const { greska } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {sr.signIn.title}
          </h1>
          <p className="text-muted-foreground text-sm">{sr.signIn.subtitle}</p>
        </div>

        {greska ? (
          <p role="alert" className="text-destructive text-center text-sm">
            {greska === "google"
              ? sr.callback.googleFailed
              : sr.callback.failed}
          </p>
        ) : null}

        <SignInForm />
      </div>
    </main>
  );
}
