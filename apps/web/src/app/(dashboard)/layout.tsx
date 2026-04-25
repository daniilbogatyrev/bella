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
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Header />
          <div className="p-6">{children}</div>
        </main>
      </div>
    </Providers>
  );
}
