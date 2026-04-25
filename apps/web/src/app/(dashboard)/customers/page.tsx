import { getDb } from '@bella/db';
import Link from 'next/link';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">
            Manage your customer directory
          </p>
        </div>
        <AddCustomerDialog />
      </div>

      <form className="relative max-w-sm">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          name="q"
          placeholder="Search by name, phone, or email..."
          defaultValue={q ?? ''}
          className="pl-8"
        />
      </form>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <UsersIcon className="size-10 text-muted-foreground/50 mb-3" />
          <h3 className="font-display text-lg font-medium">No customers found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {q ? 'Try adjusting your search query.' : 'Add your first customer to get started.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-center"># Policies</TableHead>
                <TableHead className="text-center"># Claims</TableHead>
                <TableHead>Member Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.firstName} {c.lastName}
                    </Link>
                  </TableCell>
                  <TableCell>{c.phone}</TableCell>
                  <TableCell>{c.email ?? '—'}</TableCell>
                  <TableCell className="text-center">{c.policies.length}</TableCell>
                  <TableCell className="text-center">{c.claims.length}</TableCell>
                  <TableCell>
                    {c.createdAt.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
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
