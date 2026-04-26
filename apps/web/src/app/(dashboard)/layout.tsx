import { Providers } from '@/components/layout/providers';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="sm:ml-64">
          <Header />
          <main className="p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </Providers>
  );
}
