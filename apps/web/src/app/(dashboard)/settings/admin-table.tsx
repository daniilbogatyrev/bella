'use client';

import { useState, useTransition } from 'react';
import { addAdmin, removeAdmin } from './actions';
import type { AdminUser } from '@bella/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Trash2, UserPlus, Loader2 } from 'lucide-react';

interface AdminTableProps {
  admins: AdminUser[];
  currentEmail: string;
}

export function AdminTable({ admins, currentEmail }: AdminTableProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addAdmin(email);
      if (result.success) {
        setEmail('');
      } else {
        setError(result.error ?? 'Failed to add admin');
      }
    });
  }

  function handleRemove(adminId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeAdmin(adminId);
      if (!result.success) {
        setError(result.error ?? 'Failed to remove admin');
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Admin</CardTitle>
          <CardDescription>
            Grant admin access to a Google account. They&apos;ll be able to sign
            in and access the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-3">
            <Input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="max-w-sm"
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 size-4" />
              )}
              Add Admin
            </Button>
          </form>
          {error && (
            <p className="mt-2 text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin Users</CardTitle>
          <CardDescription>
            {admins.length} admin{admins.length !== 1 ? 's' : ''} with access to
            the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((admin) => (
                <TableRow key={admin.id}>
                  <TableCell className="font-medium">
                    {admin.email}
                    {admin.email === currentEmail && (
                      <Badge variant="outline" className="ml-2">
                        you
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{admin.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{admin.role}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {admin.createdAt
                      ? new Date(admin.createdAt).toLocaleDateString()
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {admin.email !== currentEmail && (
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        onClick={() => handleRemove(admin.id)}
                        disabled={isPending}
                        aria-label={`Remove ${admin.email}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
