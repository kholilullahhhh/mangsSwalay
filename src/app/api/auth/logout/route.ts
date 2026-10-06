import { NextResponse } from "next/server";

import { destroySession } from "@/lib/auth/session";
import { audit, getRequestMeta } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * POST /api/auth/logout
 *
 * Exposed as a route handler (rather than only a Server Action) so the logout
 * button can be triggered from any client component without threading a form
 * action through the layout.
 *
 * Always returns 204, whether or not a session existed: logging out twice, or
 * from an already-expired session, is not an error the user needs to see.
 */
export async function POST(): Promise<NextResponse> {
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

  return new NextResponse(null, { status: 204 });
}