"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";

import { login } from "@/lib/auth/login";
import { audit, getRequestMeta } from "@/lib/audit";
import { prisma } from "@/lib/db";

/**
 * Login Server Action.
 *
 * Validates with Zod on the server, then delegates to `login()` which verifies
 * the bcrypt hash and opens the session. Every path — success, bad password,
 * and thrown error — is returned as state rather than redirected, so
 * `useActionState` can render the message inline.
 */

const loginSchema = z.object({
  username: z
    .string()
    .min(1, "Username atau email wajib diisi.")
    .max(255, "Username terlalu panjang."),
  password: z.string().min(1, "Password wajib diisi."),
});

export interface LoginState {
  error?: string;
  /** Field-level messages keyed by input name. */
  fieldErrors?: Record<string, string[]>;
}

/**
 * The caller's address, for the brute-force limiter.
 *
 * `x-forwarded-for` is append-only, so the last hop is the one written by our own
 * infrastructure; everything before it was supplied by the caller and is not
 * trustworthy. Falls back to the platform headers Vercel and most CDNs set, and
 * finally to `null` — which makes the limiter key on the identifier alone rather
 * than silently trusting a header we cannot vouch for.
 */
function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");

  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim());

    if (hops.length > 0 && hops[hops.length - 1]) {
      return hops[hops.length - 1];
    }
  }

  return (
    headers.get("x-real-ip") ??
    headers.get("x-vercel-forwarded-for") ??
    null
  );
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const headerList = await headers();

  // The *last* entry, not the first.
  //
  // `x-forwarded-for` is append-only: every proxy in the chain adds to it, so the
  // right-most value is the one written by the infrastructure closest to us and
  // the left-most is whatever the client sent. Reading the left-most meant the
  // caller chose their own rate-limit bucket — rotating the header gave an
  // unlimited number of guesses, defeating the limiter entirely.
  const ip = clientIp(headerList);

  const result = await login({
    username: parsed.data.username,
    password: parsed.data.password,
    ip,
  });

  if (!result.ok) {
    await audit({
      userId: null,
      action: "LOGIN_FAILED",
      entity: "User",
      newData: { username: parsed.data.username },
    });

    return { error: result.error ?? "Login gagal." };
  }

  const user = await prisma.user.findUnique({
    where: { username: parsed.data.username },
    select: { id: true, role: true, name: true },
  });

  const meta = await getRequestMeta();

  await audit({
    userId: user?.id ?? null,
    action: "LOGIN",
    entity: "User",
    entityId: user?.id ?? null,
    newData: { role: user?.role },
    ...meta,
  });

  // Send the user back where they were headed before the proxy bounced them.
  const from = formData.get("from");
  redirect(typeof from === "string" && from.startsWith("/") ? from : "/dashboard");
}