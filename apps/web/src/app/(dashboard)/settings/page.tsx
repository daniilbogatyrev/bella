import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getAdminUsers } from './actions';
import { AdminTable } from './admin-table';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'admin') redirect('/dashboard');

  const admins = await getAdminUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage admin users and access</p>
      </div>
      <AdminTable admins={admins} currentEmail={session.user.email} />
    </div>
  );
}
