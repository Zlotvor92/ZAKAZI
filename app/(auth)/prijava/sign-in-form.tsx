"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sr } from "@/lib/i18n/sr";
import {
  requestMagicLink,
  signInWithGoogle,
  type SignInState,
} from "./actions";

/** Googleov znak; ime i boje su njihove, pa se ne prepravljaju. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-5">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.8 2.6 13.6l7.8 6c1.9-5.6 7.1-9.6 13.6-10.1z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.2 7-17.4z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .8-4.4l-7.8-6C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-6z"
      />
      <path
        fill="#34A853"
        d="M24 47.5c6.5 0 11.9-2.1 15.9-5.9l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.5 0-11.7-4-13.6-9.6l-7.8 6C6.5 42.2 14.6 47.5 24 47.5z"
      />
    </svg>
  );
}

function GoogleButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full gap-2"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const result = await signInWithGoogle();
            if (result.status === "error") {
              setMessage(result.message);
            }
          });
        }}
      >
        <GoogleMark />
        {pending ? sr.signIn.googleGoing : sr.signIn.google}
      </Button>

      {message ? (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">{sr.signIn.googleHint}</p>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? sr.signIn.submitting : sr.signIn.submit}
    </Button>
  );
}

export function SignInForm() {
  const [state, formAction] = useActionState<SignInState, FormData>(
    requestMagicLink,
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <div className="space-y-2 text-center">
        <h2 className="text-lg font-medium">{sr.signIn.sentTitle}</h2>
        <p className="text-muted-foreground text-sm">{sr.signIn.sentBody}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <GoogleButton />

      {/* Mejlom se prijavljuje onaj ko nema Google nalog; oba puta vode istom
          korisniku, jer se traži ista adresa. */}
      <div className="flex items-center gap-3">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs">{sr.signIn.or}</span>
        <span className="bg-border h-px flex-1" />
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            {sr.signIn.emailLabel}
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder={sr.signIn.emailPlaceholder}
            aria-describedby={
              state.status === "error" ? "email-error" : undefined
            }
          />
        </div>

        {state.status === "error" ? (
          <p id="email-error" role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        ) : null}

        <SubmitButton />
      </form>
    </div>
  );
}
