import { getDb } from '@bella/db';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { AddCustomerDialog } from '@/components/customers/add-customer-dialog';
import { UsersIcon, SearchIcon } from 'lucide-react';

interface CustomersPageProps {
  searchParams: Promise<{ q?: string }>;
}

async function getCustomers(query?: string) {
  try {
    const db = getDb();
    const allCustomers = await db.query.customers.findMany({
      with: { policies: true, claims: true },
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });

    if (!query?.trim()) return allCustomers;

    const q = query.toLowerCase();
    return allCustomers.filter(
      (c) =>
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false),
    );
  } catch {
    return [];
  }
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const { q } = await searchParams;
  const data = await getCustomers(q);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Customers</h1>
        <AddCustomerDialog />
      </div>

      {/* Search */}
      <form className="relative max-w-sm">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          name="q"
          placeholder="Search by name, phone, or email..."
          defaultValue={q ?? ''}
          className="pl-9"
        />
      </form>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <UsersIcon className="size-10 text-muted-foreground/50 mb-3" />
          <h3 className="text-lg font-medium">No customers found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {q ? 'Try adjusting your search query.' : 'Add your first customer to get started.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Name</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Phone</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Email</th>
                <th className="h-12 px-4 text-center font-medium text-muted-foreground"># Policies</th>
                <th className="h-12 px-4 text-center font-medium text-muted-foreground"># Claims</th>
                <th className="h-12 px-4 text-left font-medium text-muted-foreground">Member Since</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b transition-colors hover:bg-muted/50">
                  <td className="p-4">
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.firstName} {c.lastName}
                    </Link>
                  </td>
                  <td className="p-4">{c.phone}</td>
                  <td className="p-4">{c.email ?? '—'}</td>
                  <td className="p-4 text-center">{c.policies.length}</td>
                  <td className="p-4 text-center">{c.claims.length}</td>
                  <td className="p-4">
                    {c.createdAt.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
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
