"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sr } from "@/lib/i18n/sr";
import { addSalon, type AdminState } from "./actions";

/** „Salon Smiley" → „salon-smiley". Adresa se kuca samo ako je predlog loš. */
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

export function NewSalonForm() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AdminState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {sr.admin.newTitle}
      </Button>
    );
  }

  return (
    <form
      action={(formData) => {
        startTransition(async () => {
          setState(await addSalon(formData));
        });
      }}
      className="border-border space-y-4 rounded-xl border p-4"
    >
      <div>
        <h2 className="font-semibold">{sr.admin.newTitle}</h2>
        <p className="text-muted-foreground pt-1 text-sm">{sr.admin.newHint}</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          {sr.admin.nameLabel}
        </label>
        <Input
          id="name"
          name="name"
          required
          maxLength={60}
          value={name}
          placeholder={sr.admin.namePlaceholder}
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
          {sr.admin.slugLabel}
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
          {sr.admin.slugHint}
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="ownerEmail" className="text-sm font-medium">
          {sr.admin.ownerEmailLabel}
        </label>
        <Input
          id="ownerEmail"
          name="ownerEmail"
          type="email"
          required
          maxLength={200}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={sr.admin.ownerEmailPlaceholder}
          aria-describedby="owner-hint"
        />
        <p id="owner-hint" className="text-muted-foreground text-xs">
          {sr.admin.ownerEmailHint}
        </p>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" className="h-12 w-full" disabled={pending}>
        {pending ? sr.admin.submitting : sr.admin.submit}
      </Button>
    </form>
  );
}
