"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sr } from "@/lib/i18n/sr";
import { createSalon, type NewTenantState } from "./actions";

/** „Studio Milica" → „studio-milica". Adresa se kuca samo ako je predlog loš. */
function toSlug(name: string): string {
  const map: Record<string, string> = {
    č: "c",
    ć: "c",
    ž: "z",
    š: "s",
    đ: "dj",
  };

  return name
    .toLowerCase()
    .replace(/[čćžšđ]/g, (letter) => map[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function NewTenantForm() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<NewTenantState>({ status: "idle" });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      setState(await createSalon(formData));
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          {sr.tenants.nameLabel}
        </label>
        <Input
          id="name"
          name="name"
          required
          maxLength={60}
          value={name}
          placeholder={sr.tenants.namePlaceholder}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugTouched) {
              setSlug(toSlug(event.target.value));
            }
          }}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="slug" className="text-sm font-medium">
          {sr.tenants.slugLabel}
        </label>
        <Input
          id="slug"
          name="slug"
          required
          minLength={3}
          maxLength={40}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          value={slug}
          aria-describedby="slug-hint"
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(toSlug(event.target.value));
          }}
        />
        <p id="slug-hint" className="text-muted-foreground text-xs">
          {sr.tenants.slugHint}
        </p>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" className="h-12 w-full" disabled={pending}>
        {pending ? sr.tenants.submitting : sr.tenants.submit}
      </Button>
    </form>
  );
}
