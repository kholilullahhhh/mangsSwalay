"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loginAction, type LoginState } from "../actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      className="h-11 w-full font-semibold shadow-sm transition-all"
      disabled={pending}
    >
      {pending ? (
        <>
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          Memverifikasi akun...
        </>
      ) : (
        <>
          Masuk ke Dashboard
          <LogIn className="ml-2 size-4" aria-hidden />
        </>
      )}
    </Button>
  );
}

export function LoginForm({ from }: { from?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );
  const [showPassword, setShowPassword] = useState(false);

  const usernameError = state.fieldErrors?.username?.[0];
  const passwordError = state.fieldErrors?.password?.[0];

  return (
    <form action={formAction} className="space-y-4 sm:space-y-5" noValidate>
      {from ? <input type="hidden" name="from" value={from} /> : null}

      {state.error ? (
        <Alert variant="destructive" role="alert" aria-live="polite">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="username">Username atau email</Label>
        <Input
          id="username"
          name="username"
          type="text"
          placeholder="Masukkan username atau email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={Boolean(usernameError)}
          aria-describedby={usernameError ? "username-error" : undefined}
          className="h-11 bg-background"
        />
        {usernameError ? (
          <p
            id="username-error"
            className="break-words text-sm text-destructive"
            role="alert"
          >
            {usernameError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>

        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            placeholder="Masukkan password"
            autoComplete="current-password"
            required
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? "password-error" : undefined}
            className="h-11 bg-background pr-12"
          />

          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>

        {passwordError ? (
          <p
            id="password-error"
            className="break-words text-sm text-destructive"
            role="alert"
          >
            {passwordError}
          </p>
        ) : null}
      </div>

      <SubmitButton />

      <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">Jaga keamanan akun kamu</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Jangan bagikan password kepada orang lain. Pastikan kamu
            menggunakan perangkat yang tepercaya.
          </p>
        </div>
      </div>
    </form>
  );
}
