"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sr } from "@/lib/i18n/sr";
import { requestMagicLink, type SignInState } from "./actions";

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
          aria-describedby={state.status === "error" ? "email-error" : undefined}
        />
      </div>

      {state.status === "error" ? (
        <p id="email-error" role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
