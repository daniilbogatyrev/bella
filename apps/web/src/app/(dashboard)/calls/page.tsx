import Link from 'next/link';
import { getDb } from '@/lib/db';
import { callSessions, customers, callStatusEnum } from '@bella/db';
import { eq, ilike, desc, or, type SQL } from 'drizzle-orm';
import { formatDate, formatDuration, formatPhone } from '@/lib/format';
import { Phone } from 'lucide-react';
import { TestCallDialog } from '@/components/calls/test-call-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const statusColors: Record<string, string> = {
  active:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  completed:
    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const statusLabels: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  failed: 'Failed',
};

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const statusFilter = params.status;
  const query = params.q?.trim();

  let callRows: {
    id: string;
    callerPhone: string;
    status: string;
    startedAt: Date;
    endedAt: Date | null;
    summary: string | null;
    customerFirstName: string | null;
    customerLastName: string | null;
    customerId: string | null;
  }[] = [];

  try {
    const db = getDb();

    const conditions: SQL[] = [];
    if (
      statusFilter &&
      callStatusEnum.enumValues.includes(statusFilter as never)
    ) {
      conditions.push(eq(callSessions.status, statusFilter as never));
    }
    if (query) {
      conditions.push(
        or(
          ilike(callSessions.callerPhone, `%${query}%`),
          ilike(callSessions.summary, `%${query}%`),
          ilike(customers.firstName, `%${query}%`),
          ilike(customers.lastName, `%${query}%`)
        )!
      );
    }

    const rows = await db
      .select({
        id: callSessions.id,
        callerPhone: callSessions.callerPhone,
        status: callSessions.status,
        startedAt: callSessions.startedAt,
        endedAt: callSessions.endedAt,
        summary: callSessions.summary,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerId: customers.id,
      })
      .from(callSessions)
      .leftJoin(customers, eq(callSessions.customerId, customers.id))
      .where(
        conditions.length > 0
          ? conditions.length === 1
            ? conditions[0]
            : or(...conditions)!
          : undefined
      )
      .orderBy(desc(callSessions.startedAt));

    callRows = rows;
  } catch {
    // DB not connected — fall back to empty list
  }

  const allStatuses = callStatusEnum.enumValues;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Calls</h1>
          <p className="text-muted-foreground">
            Call history and session recordings
          </p>
        </div>
        <TestCallDialog />
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          name="q"
          placeholder="Search by phone, customer, or summary…"
          defaultValue={query ?? ''}
          className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? ''}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">All Statuses</option>
          {allStatuses.map((s) => (
            <option key={s} value={s}>
              {statusLabels[s] ?? s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          Filter
        </button>
      </form>

      {/* Table */}
      {callRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Phone className="size-10 text-muted-foreground/50 mb-3" />
          <h3 className="font-display text-lg font-medium">No calls found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {query || statusFilter
              ? 'Try adjusting your search or filter.'
              : 'Calls will appear here once agents start receiving them.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {callRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/calls/${row.id}`}
                      className="font-mono text-primary hover:underline"
                    >
                      {formatPhone(row.callerPhone)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.customerId ? (
                      <Link
                        href={`/customers/${row.customerId}`}
                        className="text-primary hover:underline"
                      >
                        {row.customerFirstName} {row.customerLastName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground italic">
                        Unknown
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[row.status] ?? ''}`}
                    >
                      {statusLabels[row.status] ?? row.status}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(row.startedAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDuration(row.startedAt, row.endedAt)}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {row.summary || (
                      <span className="italic text-muted-foreground">
                        No summary
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
