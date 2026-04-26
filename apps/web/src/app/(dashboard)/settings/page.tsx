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
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
      </div>

      {/* Password section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Password Management
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage your login credentials
          </p>
        </div>
        <PasswordForm hasPassword={hasPassword} />
      </section>

      {/* Admin section */}
      {isAdmin && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Admin Management
            </h2>
            <p className="text-sm text-muted-foreground">
              Manage who has access to this dashboard
            </p>
          </div>
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
