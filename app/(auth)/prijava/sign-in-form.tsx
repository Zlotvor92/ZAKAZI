"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { display } from "@/app/fonts";
import { sr } from "@/lib/i18n/sr";
import { isRedirect } from "@/lib/utils";
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

const ERROR = "border-l-2 border-[#B3261E] pl-3 text-sm leading-relaxed text-[#B3261E]";
const LABEL = "text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase";

function GoogleButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {/*
        Dugme ostaje belo, sa njihovim znakom i punim imenom, jer to traže
        Googleova pravila za prijavu. Uz okvir strane ga vezuje samo boja
        linije i ugao — ništa od onoga što ta pravila propisuju.
      */}
      <button
        type="button"
        disabled={pending}
        className="flex h-14 w-full items-center justify-center gap-3 rounded-sm border border-[#DED5C7] bg-white text-[15px] font-medium text-[#211D1A] disabled:opacity-60"
        onClick={() => {
          startTransition(async () => {
            try {
              const result = await signInWithGoogle();
              if (result.status === "error") {
                setMessage(result.message);
              }
            } catch (cause) {
              // Uspeh iz ove akcije stiže kao `redirect()` na Google, a on do
              // pregledača dolazi kao greška. Takva mora dalje do rutera —
              // progutana bi značila da dugme za prijavu ne radi ništa.
              if (isRedirect(cause)) {
                throw cause;
              }
              setMessage(sr.error.unreachable);
            }
          });
        }}
      >
        <GoogleMark />
        {pending ? sr.signIn.googleGoing : sr.signIn.google}
      </button>

      {message ? (
        <p role="alert" className={ERROR}>
          {message}
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-[#6B6055]">
        {sr.signIn.googleHint}
      </p>
    </div>
  );
}

/**
 * Google se nudi svuda osim tamo gde je izričito isključen.
 *
 * Kad provajder nije podešen u Supabase-u, `signInWithOAuth` i dalje uredno
 * sastavi adresu — greška stiže tek kad pregledač ode na nju, i to kao sirov
 * JSON na beloj strani bez povratka. To se ne može uhvatiti unapred, pa
 * okruženje u kojem Google nije podešen (podrazumevano lokalno) dugme ne
 * prikazuje umesto da vodi u ćorsokak.
 */
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN !== "false";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-14 w-full items-center justify-center bg-[#211D1A] text-xs font-bold tracking-[0.18em] text-[#FBF7F0] uppercase disabled:opacity-60"
    >
      {pending ? sr.signIn.submitting : sr.signIn.submit}
    </button>
  );
}

export function SignInForm() {
  // Poziv akcije ume da padne pre nego što ona išta vrati — mreža u liftu,
  // prekinut zahtev. `useActionState` takav pad iznosi do granice greške, pa
  // bi umesto jedne rečenice ispod polja pukla cela strana za prijavu.
  const [state, formAction] = useActionState<SignInState, FormData>(
    async (previous, formData) => {
      try {
        return await requestMagicLink(previous, formData);
      } catch {
        return { status: "error", message: sr.error.unreachable };
      }
    },
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <div className="flex flex-col gap-3 border-t-2 border-[#211D1A] pt-4">
        <h2 className={`${display.className} text-[28px] leading-tight`}>
          {sr.signIn.sentTitle}
        </h2>
        <p className="text-sm leading-relaxed text-[#554C44]">
          {sr.signIn.sentBody}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {GOOGLE_ENABLED ? (
        <>
          <GoogleButton />

          {/* Mejlom se prijavljuje onaj ko nema Google nalog; oba puta vode
              istom korisniku, jer se traži ista adresa. */}
          <div className="flex items-center gap-4">
            <span className="h-px flex-1 bg-[#DED5C7]" />
            <span className="text-[10.5px] font-bold tracking-[0.18em] text-[#6B6055] uppercase">
              {sr.signIn.or}
            </span>
            <span className="h-px flex-1 bg-[#DED5C7]" />
          </div>
        </>
      ) : null}

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className={LABEL}>
            {sr.signIn.emailLabel}
          </label>
          <input
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
            className="h-13 w-full rounded-sm border border-[#DED5C7] bg-white px-4 text-base text-[#211D1A] outline-none placeholder:text-[#A2988A] focus-visible:border-[#8C1D3F] focus-visible:ring-1 focus-visible:ring-[#8C1D3F]"
          />
        </div>

        {state.status === "error" ? (
          <p id="email-error" role="alert" className={ERROR}>
            {state.message}
          </p>
        ) : null}

        <SubmitButton />
      </form>
    </div>
  );
}
