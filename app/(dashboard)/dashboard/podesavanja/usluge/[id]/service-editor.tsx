"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Service } from "@/lib/db/services";
import { sr } from "@/lib/i18n/sr";
import {
  deleteServiceEntry,
  saveServiceEntry,
  type SettingsState,
} from "../../actions";
import { DescriptionField, Feedback, Field } from "../../settings-forms";
import { LIST_HREF } from "./paths";

const selectClass =
  "h-11 w-full min-w-0 rounded-md border border-[#E4DAC9] bg-white px-2 text-base";

function Card({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-[20px] border border-[#E4DAC9] bg-white p-4">
      <h2 className="text-[11px] font-bold tracking-[0.14em] text-[#8C1D3F] uppercase">
        {title}
      </h2>
      {intro ? <p className="text-xs text-[#6B6055]">{intro}</p> : null}
      {children}
    </section>
  );
}

function ServiceSelect({
  name,
  empty,
  value,
  others,
}: {
  name: string;
  empty: string;
  value: string | null;
  others: Service[];
}) {
  return (
    <select name={name} defaultValue={value ?? ""} className={selectClass}>
      <option value="">{empty}</option>
      {others.map((other) => (
        <option key={other.id} value={other.id}>
          {other.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Jedna usluga na svom ekranu, u tri celine: osnovno, opis, pravila.
 *
 * Posle uspešnog čuvanja vraća na spisak, gde se izmena odmah vidi u redu
 * usluge. Kad čuvanje ne uspe, ostaje ovde sa upisanim — `onSubmit`, ne
 * `action`, jer forma sa akcijom posle slanja sama isprazni polja.
 */
export function ServiceEditor({
  service,
  others,
}: {
  service: Service | null;
  others: Service[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SettingsState>({ status: "idle" });

  function run(work: () => Promise<SettingsState>) {
    startTransition(async () => {
      let result: SettingsState;
      try {
        result = await work();
      } catch {
        result = { status: "error", message: sr.error.unreachable };
      }

      if (result.status === "error") {
        setState(result);
        return;
      }
      router.push(LIST_HREF);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        run(() => saveServiceEntry(formData));
      }}
      onChange={() =>
        setState((current) =>
          current.status === "idle" ? current : { status: "idle" },
        )
      }
      className="space-y-3"
    >
      <input type="hidden" name="id" value={service?.id ?? ""} />

      <Card title={sr.settings.serviceBasics}>
        <Field label={sr.settings.serviceName}>
          <Input
            name="name"
            defaultValue={service?.name ?? ""}
            placeholder={sr.settings.serviceNamePlaceholder}
            maxLength={60}
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={sr.settings.serviceDuration}>
            <Input
              name="durationMin"
              type="text"
              inputMode="numeric"
              defaultValue={service?.duration_min ?? 90}
              required
            />
          </Field>
          <Field label={sr.settings.servicePrice}>
            <Input
              name="priceRsd"
              type="text"
              inputMode="numeric"
              defaultValue={service?.price_rsd ?? 0}
              required
            />
          </Field>
        </div>
      </Card>

      <Card title={sr.settings.serviceDescriptionTitle}>
        <DescriptionField defaultValue={service?.description ?? ""} />
      </Card>

      {others.length > 0 ? (
        <>
          <Card
            title={sr.settings.serviceWindowTitle}
            intro={sr.settings.serviceWindowIntro}
          >
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
              <Field label={sr.settings.serviceWindowDays}>
                <Input
                  name="requiresWithinDays"
                  type="text"
                  inputMode="numeric"
                  defaultValue={service?.requires_within_days ?? ""}
                  placeholder="21"
                />
              </Field>
              <Field label={sr.settings.serviceWindowServiceLabel}>
                <ServiceSelect
                  name="requiresServiceId"
                  empty={sr.settings.serviceWindowNone}
                  value={service?.requires_service_id ?? null}
                  others={others}
                />
              </Field>
            </div>
            <p className="text-[11px] text-[#6B6055]">
              {sr.settings.serviceWindowHint}
            </p>
          </Card>

          <Card
            title={sr.settings.serviceSequenceTitle}
            intro={sr.settings.serviceSequenceIntro}
          >
            <Field label={sr.settings.serviceNotAfterLabel}>
              <ServiceSelect
                name="notAfterServiceId"
                empty={sr.settings.serviceNotAfterNone}
                value={service?.not_after_service_id ?? null}
                others={others}
              />
            </Field>
            <Field label={sr.settings.serviceNotAfterInsteadLabel}>
              <ServiceSelect
                name="notAfterInsteadServiceId"
                empty={sr.settings.serviceNotAfterInsteadNone}
                value={service?.not_after_instead_service_id ?? null}
                others={others}
              />
            </Field>
            <p className="text-[11px] text-[#6B6055]">
              {sr.settings.serviceNotAfterHint}
            </p>
          </Card>
        </>
      ) : null}

      <Feedback state={state} />

      <Button
        type="submit"
        className="h-12 w-full rounded-full"
        disabled={pending}
      >
        {service ? sr.settings.saveService : sr.settings.addService}
      </Button>

      {service ? (
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full text-[#B3261E] hover:text-[#B3261E]"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(sr.settings.removeServiceConfirm)) {
              return;
            }
            run(() => deleteServiceEntry(service.id));
          }}
        >
          {sr.settings.removeServiceLong}
        </Button>
      ) : null}
    </form>
  );
}
