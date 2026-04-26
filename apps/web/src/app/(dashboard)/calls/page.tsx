import Link from 'next/link';
import { getDb } from '@/lib/db';
import { callSessions, customers, callStatusEnum } from '@bella/db';
import { eq, ilike, desc, or, type SQL } from 'drizzle-orm';
import { formatDate, formatDuration, formatPhone } from '@/lib/format';
import { Phone } from 'lucide-react';
import { TestCallDialog } from '@/components/calls/test-call-dialog';

const statusStyles: Record<string, string> = {
  active:
    'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/10 dark:text-green-400 dark:ring-green-500/20',
  completed:
    'bg-gray-50 text-gray-600 ring-gray-500/10 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20',
  failed:
    'bg-red-50 text-red-700 ring-red-600/10 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20',
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
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Calls</h1>
        <TestCallDialog />
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          name="q"
          placeholder="Search by phone, customer, or summary…"
          defaultValue={query ?? ''}
          className="h-8 w-64 rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? ''}
          className="h-8 rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30"
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
          className="shadow-sm shadow-black/20 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 text-xs h-7 font-medium transition-colors"
        >
          Filter
        </button>
      </form>

      {/* Table */}
      {callRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Phone className="size-10 text-muted-foreground/50 mb-3" />
          <h3 className="text-lg font-medium">No calls found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {query || statusFilter
              ? 'Try adjusting your search or filter.'
              : 'Calls will appear here once agents start receiving them.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Phone</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Customer</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Status</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Started</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Duration</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Summary</th>
              </tr>
            </thead>
            <tbody>
              {callRows.map((row) => (
                <tr key={row.id} className="border-b transition-colors hover:bg-muted/50">
                  <td className="p-4">
                    <Link
                      href={`/calls/${row.id}`}
                      className="font-mono text-primary hover:underline"
                    >
                      {formatPhone(row.callerPhone)}
                    </Link>
                  </td>
                  <td className="p-4">
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
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[row.status] ?? ''}`}
                    >
                      {statusLabels[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="p-4 whitespace-nowrap">
                    {formatDate(row.startedAt)}
                  </td>
                  <td className="p-4 whitespace-nowrap">
                    {formatDuration(row.startedAt, row.endedAt)}
                  </td>
                  <td className="p-4 max-w-xs truncate">
                    {row.summary || (
                      <span className="italic text-muted-foreground">
                        No summary
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
