import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getAdminUsers, getPasswordStatus } from './actions';
import { AdminTable } from './admin-table';
import { PasswordForm } from './password-form';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const isAdmin = session.user.role === 'admin';
  const { hasPassword } = await getPasswordStatus();

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and access</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Password</h2>
        <PasswordForm hasPassword={hasPassword} />
      </section>

      {isAdmin && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Admin Management</h2>
          <AdminSection currentEmail={session.user.email} />
        </section>
      )}
    </div>
  );
}

async function AdminSection({ currentEmail }: { currentEmail: string }) {
  const admins = await getAdminUsers();
  return <AdminTable admins={admins} currentEmail={currentEmail} />;
}
