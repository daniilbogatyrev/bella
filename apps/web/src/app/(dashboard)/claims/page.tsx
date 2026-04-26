import Link from 'next/link';
import { getDb } from '@/lib/db';
import { claims, customers, claimStatusEnum } from '@bella/db';
import { eq, ilike, desc, or, type SQL } from 'drizzle-orm';
import { NewClaimDialog } from '@/components/claims/new-claim-dialog';

const statusStyles: Record<string, string> = {
  draft:
    'bg-gray-50 text-gray-600 ring-gray-500/10 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20',
  gathering_info:
    'bg-yellow-50 text-yellow-700 ring-yellow-600/20 dark:bg-yellow-500/10 dark:text-yellow-400 dark:ring-yellow-500/20',
  ready_for_review:
    'bg-blue-50 text-blue-700 ring-blue-700/10 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20',
  submitted:
    'bg-indigo-50 text-indigo-700 ring-indigo-700/10 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/20',
  under_review:
    'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/20',
  approved:
    'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/10 dark:text-green-400 dark:ring-green-500/20',
  denied:
    'bg-red-50 text-red-700 ring-red-600/10 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20',
  closed:
    'bg-gray-50 text-gray-600 ring-gray-500/10 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20',
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
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Claims</h1>
        <NewClaimDialog />
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          name="q"
          placeholder="Search by customer or description…"
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
      {claimRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No claims found</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">ID</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Customer</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Type</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Status</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Created</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Updated</th>
              </tr>
            </thead>
            <tbody>
              {claimRows.map((row) => (
                <tr key={row.id} className="border-b transition-colors hover:bg-muted/50">
                  <td className="p-4">
                    <Link
                      href={`/claims/${row.id}`}
                      className="font-mono text-primary hover:underline"
                    >
                      {row.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="p-4">
                    {row.customerFirstName} {row.customerLastName}
                  </td>
                  <td className="p-4 capitalize">{row.type}</td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[row.status] ?? ''}`}
                    >
                      {statusLabels[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="p-4">{row.createdAt.toLocaleDateString()}</td>
                  <td className="p-4">{row.updatedAt.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
