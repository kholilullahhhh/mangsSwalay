"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, UserMinus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/data/empty-state";
import { formatDateTime } from "@/lib/format";

import {
  createUserAction,
  deactivateUserAction,
  updateUserAction,
  type CrudResult,
} from "@/app/(dashboard)/admin/actions";
import { CheckboxField, Field, FormError } from "@/components/admin/fields";

/**
 * Staff table with create and edit.
 *
 * A password is only required when creating. On edit, leaving it blank keeps the
 * current one: forcing a reset on every unrelated profile tweak would be an easy
 * way to lock a cashier out mid-shift.
 */

export interface UserRow {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  salesCount: number;
}

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  SUPER_ADMIN: "default",
  ADMIN: "default",
  MANAGER: "secondary",
  CASHIER: "outline",
  STOCK_OPERATOR: "outline",
};

export function UserTable({
  users,
  roles,
  canManage,
}: {
  users: UserRow[];
  roles: Array<{ value: string; label: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);

  function deactivate(user: UserRow) {
    const formData = new FormData();
    formData.set("id", user.id);

    startTransition(async () => {
      const result = await deactivateUserAction(formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Pengguna dinonaktifkan.");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Menonaktifkan pengguna akan mengakhiri sesi aktifnya.
        </p>

        {canManage ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            Tambah Pengguna
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="px-0">
          {users.length === 0 ? (
            <EmptyState
              title="Belum ada pengguna"
              description="Tambahkan akun kasir atau staf pertama."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Peran</TableHead>
                  <TableHead>Login Terakhir</TableHead>
                  <TableHead className="text-right">Transaksi</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? (
                    <TableHead className="text-right">Aksi</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>

              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <p className="font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </TableCell>

                    <TableCell className="font-mono text-xs">
                      {user.username}
                    </TableCell>

                    <TableCell>
                      <Badge variant={ROLE_VARIANT[user.role] ?? "outline"}>
                        {roles.find((role) => role.value === user.role)?.label ??
                          user.role}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {user.lastLoginAt
                        ? formatDateTime(user.lastLoginAt)
                        : "belum pernah"}
                    </TableCell>

                    <TableCell className="tabular text-right">
                      {user.salesCount.toLocaleString("id-ID")}
                    </TableCell>

                    <TableCell>
                      <Badge variant={user.isActive ? "default" : "outline"}>
                        {user.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>

                    {canManage ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${user.name}`}
                            onClick={() => setEditing(user)}
                            disabled={isPending}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>

                          {user.isActive ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Nonaktifkan ${user.name}`}
                              onClick={() => deactivate(user)}
                              disabled={isPending}
                            >
                              <UserMinus className="size-4" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UserDialog
        open={creating}
        onOpenChange={setCreating}
        roles={roles}
      />

      <UserDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        user={editing}
        roles={roles}
      />
    </>
  );
}

function UserDialog({
  open,
  onOpenChange,
  user,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: UserRow | null;
  roles: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const isEditing = Boolean(user);

  function handleSubmit(formData: FormData) {
    setFieldErrors({});
    setFormError(null);

    if (user) formData.set("id", user.id);

    startTransition(async () => {
      const result: CrudResult = isEditing
        ? await updateUserAction(formData)
        : await createUserAction(formData);

      if (result.error) {
        setFormError(result.error);
        return;
      }

      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
        return;
      }

      toast.success(isEditing ? "Pengguna diperbarui." : "Pengguna ditambahkan.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Pengguna" : "Tambah Pengguna"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Kosongkan password untuk tidak mengubahnya."
              : "Pengguna baru bisa langsung login dengan password ini."}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-5">
          <FormError message={formError} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama Lengkap" name="name" error={fieldErrors.name} required>
              {(props) => (
                <Input {...props} defaultValue={user?.name} />
              )}
            </Field>

            <Field
              label="Username"
              name="username"
              error={fieldErrors.username}
              hint="Huruf kecil, angka, titik, garis bawah."
              required
            >
              {(props) => (
                <Input
                  {...props}
                  defaultValue={user?.username}
                  autoComplete="off"
                  className="font-mono"
                  readOnly={isEditing}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" name="email" error={fieldErrors.email} required>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  defaultValue={user?.email}
                  autoComplete="off"
                />
              )}
            </Field>

            <Field label="Telepon" name="phone" error={fieldErrors.phone}>
              {(props) => (
                <Input
                  {...props}
                  defaultValue={user?.phone ?? ""}
                  inputMode="tel"
                />
              )}
            </Field>
          </div>

          <Field
            label="Peran"
            name="role"
            error={fieldErrors.role}
            hint="Peran menentukan layar dan tindakan yang bisa diakses."
            required
          >
            {(props) => (
              <Select name={props.name} defaultValue={user?.role ?? "CASHIER"}>
                <SelectTrigger id={props.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field
            label={isEditing ? "Password Baru" : "Password"}
            name="password"
            error={fieldErrors.password}
            hint={
              isEditing
                ? "Minimal 8 karakter. Kosongkan bila tidak diubah."
                : "Minimal 8 karakter."
            }
            required={!isEditing}
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="new-password"
              />
            )}
          </Field>

          <CheckboxField
            name="isActive"
            label="Akun aktif"
            defaultChecked={user?.isActive ?? true}
            hint="Akun nonaktif tidak bisa login dan sesi aktifnya diakhiri."
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Batal
            </Button>

            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Menyimpan…
                </>
              ) : isEditing ? (
                "Simpan Perubahan"
              ) : (
                "Tambah Pengguna"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}