"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { login } from "@/lib/auth/login";
import { createSession } from "@/lib/auth/session";

interface LoginState {
  ok: boolean;
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "/dashboard");

  if (!username || !password) {
    return { ok: false, error: "Username dan password wajib diisi." };
  }

  const cookieStore = await cookies();
  const ip =
    cookieStore.get("x-forwarded-for")?.value?.split(",")[0]?.trim() ?? null;

  const result = await login({ username, password, ip });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: username.toLowerCase() },
        { email: username.toLowerCase() },
      ],
    },
    select: { id: true },
  });

  if (!user) {
    return { ok: false, error: "Gagal membuat sesi. Coba lagi." };
  }

  await createSession(user.id);

  const safeFrom =
    typeof from === "string" && from.startsWith("/") && !from.startsWith("//")
      ? from
      : "/dashboard";

  redirect(safeFrom);
}
