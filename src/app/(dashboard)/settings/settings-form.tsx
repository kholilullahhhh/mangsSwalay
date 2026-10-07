"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { updateSettingsAction } from "@/app/(dashboard)/admin/actions";
import { FormError } from "@/components/admin/fields";

/**
 * Settings form.
 *
 * One form for every group so a save is a single atomic submission: a store owner
 * changing the name and the tax rate together gets both or neither. Only changed
 * fields are submitted, so saving an unrelated group does not rewrite values the
 * user never touched.
 */

export interface SettingsField {
  key: string;
  value: string | number | boolean | null;
  description: string | null;
  kind: "text" | "long" | "number" | "boolean";
}

export interface SettingsGroup {
  title: string;
  description: string;
  fields: SettingsField[];
}

export function SettingsForm({ groups }: { groups: SettingsGroup[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Snapshotted on mount: comparing against this is how "changed" is decided, so
  // re-rendering with a fresh server value never marks a field as edited.
  const [initial, setInitial] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(groups.flatMap((group) => group.fields.map((field) => [field.key, field.value]))),
  );

  const [values, setValues] = useState<Record<string, unknown>>(initial);

  const changedKeys = Object.keys(values).filter(
    (key) => String(values[key]) !== String(initial[key]),
  );

  function setValue(key: string, value: unknown) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(formData: FormData) {
    setFormError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await updateSettingsAction(formData);

      if (result.error) {
        setFormError(result.error);
        return;
      }

      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
        return;
      }

      // Re-baseline from what the server accepted, so a second save does not
      // resubmit the same values and the button correctly returns to disabled.
      setInitial(values);
      toast.success("Pengaturan disimpan.");
      router.refresh();
    });
  }

  function reset() {
    setValues(initial);
    setFormError(null);
    setFieldErrors({});
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <FormError message={formError} />

      {groups
        .filter((group) => group.fields.length > 0)
        .map((group) => (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle className="text-base">{group.title}</CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>

            <CardContent className="grid gap-4 sm:grid-cols-2">
              {group.fields.map((field) => (
                <SettingsInput
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  error={fieldErrors[field.key]}
                  changed={changedKeys.includes(field.key)}
                  onChange={(next) => setValue(field.key, next)}
                />
              ))}
            </CardContent>
          </Card>
        ))}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isPending || changedKeys.length === 0}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Menyimpan…
            </>
          ) : (
            "Simpan Pengaturan"
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={reset}
          disabled={isPending || changedKeys.length === 0}
        >
          Batalkan
        </Button>

        {changedKeys.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {changedKeys.length} pengaturan belum disimpan.
          </p>
        ) : null}
      </div>
    </form>
  );
}

function SettingsInput({
  field,
  value,
  error,
  changed,
  onChange,
}: {
  field: SettingsField;
  value: unknown;
  error?: string;
  changed: boolean;
  onChange: (value: unknown) => void;
}) {
  // Switch is uncontrolled because it has its own internal state; the change
  // handler is what keeps the form's snapshot in sync.
  if (field.kind === "boolean") {
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border p-3 sm:col-span-2">
        <div className="min-w-0">
          <Label htmlFor={field.key}>{field.key}</Label>
          {field.description ? (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <Switch
          id={field.key}
          checked={Boolean(value)}
          onCheckedChange={onChange}
        />
        {/* The server reads this key from the form data, so the switch needs a
            hidden input to submit a value at all. */}
        <input type="hidden" name={field.key} value={value ? "true" : "false"} />
      </div>
    );
  }

  // A percentage setting is stored as a fraction, so it is shown and typed in the
  // units the person editing it thinks in.
  const displayValue =
    field.key === "tax.rate" && typeof value === "number"
      ? String(Math.round(value * 10000) / 100)
      : value === null || value === undefined
        ? ""
        : String(value);

  const wide = field.kind === "long";

  const control = field.kind === "long" ? (
    <Textarea
      id={field.key}
      name={field.key}
      rows={3}
      defaultValue={displayValue}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={Boolean(error)}
      className={changed ? "border-primary" : undefined}
    />
  ) : field.kind === "number" ? (
    <Input
      id={field.key}
      name={field.key}
      type="number"
      step="any"
      min={0}
      defaultValue={displayValue}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={Boolean(error)}
      className={changed ? "border-primary" : undefined}
    />
  ) : (
    <Input
      id={field.key}
      name={field.key}
      defaultValue={displayValue}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={Boolean(error)}
      className={changed ? "border-primary" : undefined}
    />
  );

  return (
    <div className={wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={field.key}>{field.key}</Label>
      {control}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : field.description ? (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      ) : null}
    </div>
  );
}