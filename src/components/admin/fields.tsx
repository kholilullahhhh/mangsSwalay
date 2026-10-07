"use client";

import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

/**
 * Form field primitives shared by the admin dialogs.
 *
 * Extracted from the product dialog rather than duplicated: the label/required
 * marker, the error and hint ids, and the `aria-describedby` wiring are the
 * accessibility-relevant parts, and every field in the app must get them the
 * same way or screen readers announce errors inconsistently.
 */

/**
 * A labelled control.
 *
 * `children` is a render prop so the caller supplies the actual input while this
 * component owns the label, the required marker, and the accessible description
 * wiring. A caller cannot forget `aria-invalid` handling here because it does not
 * exist here at all — only the description id is passed through.
 */
export function Field({
  label,
  name,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    name: string;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </Label>

      {children({
        id: name,
        name,
        "aria-describedby": error ? errorId : hint ? hintId : undefined,
      })}

      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A checkbox that submits `"true"` when checked.
 *
 * A native checkbox submits nothing when unchecked, so a hidden input carries the
 * false value explicitly — otherwise "uncheck this box" would be indistinguishable
 * from "this field was never in the form".
 */
export function CheckboxField({
  name,
  label,
  defaultChecked,
  hint,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <input type="hidden" name={name} value="false" />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name={name}
          value="true"
          defaultChecked={defaultChecked}
          className="size-4 rounded border-input"
        />
        {label}
      </label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Form-level error banner, announced to assistive tech when it appears. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}