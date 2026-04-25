import Link from 'next/link';
import { getDb } from '@/lib/db';
import { claims, customers, claimStatusEnum } from '@bella/db';
import { eq, ilike, desc, or, type SQL } from 'drizzle-orm';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  gathering_info:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  ready_for_review:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  submitted:
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  under_review:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  approved:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  denied: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  closed: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  gathering_info: 'Gathering Info',
  ready_for_review: 'Ready for Review',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  denied: 'Denied',
  closed: 'Closed',
};

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const statusFilter = params.status;
  const query = params.q?.trim();

  let claimRows: {
    id: string;
    type: string;
    status: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    customerFirstName: string;
    customerLastName: string;
  }[] = [];

  try {
    const db = getDb();

    const conditions: SQL[] = [];
    if (
      statusFilter &&
      claimStatusEnum.enumValues.includes(statusFilter as never)
    ) {
      conditions.push(eq(claims.status, statusFilter as never));
    }
    if (query) {
      conditions.push(
        or(
          ilike(customers.firstName, `%${query}%`),
          ilike(customers.lastName, `%${query}%`),
          ilike(claims.description, `%${query}%`)
        )!
      );
    }

    const rows = await db
      .select({
        id: claims.id,
        type: claims.type,
        status: claims.status,
        description: claims.description,
        createdAt: claims.createdAt,
        updatedAt: claims.updatedAt,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
      })
      .from(claims)
      .innerJoin(customers, eq(claims.customerId, customers.id))
      .where(conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : or(...conditions)!) : undefined)
      .orderBy(desc(claims.updatedAt));

    claimRows = rows;
  } catch {
    // DB not connected — fall back to empty list
  }

  const allStatuses = claimStatusEnum.enumValues;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Claims</h1>
        <p className="text-muted-foreground">
          Manage and track insurance claims
        </p>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          name="q"
          placeholder="Search by customer or description…"
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
      {claimRows.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          No claims found
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Customer Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claimRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    href={`/claims/${row.id}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {row.id.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell>
                  {row.customerFirstName} {row.customerLastName}
                </TableCell>
                <TableCell className="capitalize">{row.type}</TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[row.status] ?? ''}`}
                  >
                    {statusLabels[row.status] ?? row.status}
                  </span>
                </TableCell>
                <TableCell>{row.createdAt.toLocaleDateString()}</TableCell>
                <TableCell>{row.updatedAt.toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
