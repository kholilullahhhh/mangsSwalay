"use client";

import { useActionState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loginAction } from "@/actions/login";

export function LoginForm({ from }: { from?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackFrom = from ?? searchParams.get("from") ?? "/dashboard";

  const [state, formAction, isPending] = useActionState(loginAction, {
    ok: false,
    error: undefined,
  });

  useEffect(() => {
    if (state.ok) {
      router.push(callbackFrom);
      router.refresh();
    }
  }, [state.ok, callbackFrom, router]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="from" value={callbackFrom} />

      <div className="space-y-2">
        <Label htmlFor="username">Username atau Email</Label>
        <Input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          placeholder="Masukkan username atau email"
          required
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Masukkan password"
          required
        />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Memproses…
          </>
        ) : (
          <>
            <LogIn className="size-4" aria-hidden />
            Masuk
          </>
        )}
      </Button>
    </form>
  );
}
