"use server";

import { redirect } from "next/navigation";

import { destroySession } from "@/lib/auth/session";
import { audit, getRequestMeta } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Logout. Destroys the server-side Session row (so the token is no longer
 * valid anywhere) and clears the cookie.
 */
export async function logoutAction(): Promise<never> {
  const user = await getCurrentUser();
  const meta = await getRequestMeta();

  if (user) {
    await audit({
      userId: user.id,
      action: "LOGOUT",
      entity: "User",
      entityId: user.id,
      ...meta,
    });
  }

  await destroySession();
  redirect("/login");
}