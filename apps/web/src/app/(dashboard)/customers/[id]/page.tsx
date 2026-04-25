import { getDb } from '@bella/db';
import { customers } from '@bella/db';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { EditCustomerDialog } from '@/components/customers/edit-customer-dialog';
import { AddPolicyDialog } from '@/components/customers/add-policy-dialog';
import {
  UserIcon,
  PhoneIcon,
  MailIcon,
  CalendarIcon,
  MapPinIcon,
  ArrowLeftIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CustomerDetailPageProps {
  params: Promise<{ id: string }>;
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  expired: 'secondary',
  cancelled: 'destructive',
  draft: 'outline',
  gathering_info: 'outline',
  ready_for_review: 'secondary',
  submitted: 'default',
  under_review: 'secondary',
  approved: 'default',
  denied: 'destructive',
  closed: 'secondary',
  completed: 'default',
  failed: 'destructive',
};

function formatStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(date: Date | string | null) {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function truncate(text: string | null, max: number) {
  if (!text) return '—';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatDuration(start: Date, end: Date | null) {
  if (!end) return '—';
  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  const { id } = await params;

  let customer;
  try {
    const db = getDb();
    customer = await db.query.customers.findFirst({
      where: eq(customers.id, id),
      with: {
        policies: true,
        claims: true,
        callSessions: true,
      },
    });
  } catch {
    customer = null;
  }

  if (!customer) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/customers">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeftIcon />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {customer.firstName} {customer.lastName}
          </h1>
          <p className="text-muted-foreground">Customer Profile</p>
        </div>
        <EditCustomerDialog
          customer={{
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone: customer.phone,
            dob: customer.dob,
            email: customer.email,
            address: customer.address,
          }}
        />
      </div>

      {/* Profile Card */}
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center gap-2 text-sm">
            <PhoneIcon className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Phone:</span>
            <span className="font-medium">{customer.phone}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <MailIcon className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Email:</span>
            <span className="font-medium">{customer.email ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CalendarIcon className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">DOB:</span>
            <span className="font-medium">{customer.dob ? formatDate(customer.dob) : '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <MapPinIcon className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Address:</span>
            <span className="font-medium">{customer.address ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <UserIcon className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Member Since:</span>
            <span className="font-medium">{formatDate(customer.createdAt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Policies Section */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Policies ({customer.policies.length})</CardTitle>
          <AddPolicyDialog customerId={customer.id} />
        </CardHeader>
        <CardContent>
          {customer.policies.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No policies yet. Add one to get started.
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Plan Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>End Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customer.policies.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="capitalize">{p.type}</TableCell>
                      <TableCell className="font-medium">{p.planName}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[p.status] ?? 'outline'}>
                          {formatStatus(p.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{p.premium ? `$${p.premium}` : '—'}</TableCell>
                      <TableCell>{formatDate(p.startDate)}</TableCell>
                      <TableCell>{formatDate(p.endDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Claims Section */}
      <Card>
        <CardHeader>
          <CardTitle>Claims ({customer.claims.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {customer.claims.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No claims filed.
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customer.claims.map((cl) => (
                    <TableRow key={cl.id}>
                      <TableCell>
                        <Link
                          href={`/claims/${cl.id}`}
                          className="font-medium text-primary hover:underline font-mono text-xs"
                        >
                          {cl.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell className="capitalize">{cl.type}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[cl.status] ?? 'outline'}>
                          {formatStatus(cl.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(cl.createdAt)}</TableCell>
                      <TableCell className="max-w-[200px]">{truncate(cl.description, 60)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calls Section */}
      <Card>
        <CardHeader>
          <CardTitle>Calls ({customer.callSessions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {customer.callSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No call records.
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customer.callSessions.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell>
                        <Link
                          href={`/calls/${call.id}`}
                          className="text-primary hover:underline"
                        >
                          {formatDate(call.startedAt)}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDuration(call.startedAt, call.endedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[call.status] ?? 'outline'}>
                          {formatStatus(call.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        {truncate(call.summary, 80)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
