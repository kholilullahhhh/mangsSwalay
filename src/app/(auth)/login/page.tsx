import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Masuk",
  description: "Masuk ke sistem manajemen Swalayaku.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawFrom = params.from;

  // Only accept same-origin relative paths, so `?from=` cannot be used to build
  // an open redirect to an external host.
  const from =
    typeof rawFrom === "string" && rawFrom.startsWith("/") && !rawFrom.startsWith("//")
      ? rawFrom
      : undefined;

  return (
    <Card className="w-full max-w-sm shadow-sm">
      <CardHeader>
        <CardTitle>Masuk ke Swalayaku</CardTitle>
        <CardDescription>
          Gunakan akun staff yang terdaftar untuk mengakses sistem.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm from={from} />
      </CardContent>
    </Card>
  );
}