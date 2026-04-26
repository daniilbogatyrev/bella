import { Phone, FileText, Users, Activity } from 'lucide-react';
import Link from 'next/link';

async function getStats() {
  try {
    const { getDb } = await import('@bella/db');
    const { callSessions, claims, customers } = await import('@bella/db');
    const { count, sql, gte } = await import('drizzle-orm');
    const db = getDb();

    const [activeCalls] = await db
      .select({ count: count() })
      .from(callSessions)
      .where(sql`${callSessions.status} = 'active'`);
    const [openClaims] = await db
      .select({ count: count() })
      .from(claims)
      .where(sql`${claims.status} NOT IN ('approved', 'denied', 'closed')`);
    const [totalCustomers] = await db
      .select({ count: count() })
      .from(customers);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [callsToday] = await db
      .select({ count: count() })
      .from(callSessions)
      .where(gte(callSessions.startedAt, today));

    return {
      activeCalls: activeCalls?.count ?? 0,
      openClaims: openClaims?.count ?? 0,
      totalCustomers: totalCustomers?.count ?? 0,
      callsToday: callsToday?.count ?? 0,
    };
  } catch {
    return { activeCalls: 0, openClaims: 0, totalCustomers: 0, callsToday: 0 };
  }
}

export default async function DashboardPage() {
  const stats = await getStats();

  const cards = [
    {
      title: 'Active Calls',
      value: stats.activeCalls,
      subtitle: 'Currently in progress',
      icon: Phone,
      href: '/calls',
      color: 'text-green-500',
    },
    {
      title: 'Open Claims',
      value: stats.openClaims,
      subtitle: 'Awaiting resolution',
      icon: FileText,
      href: '/claims',
      color: 'text-blue-500',
    },
    {
      title: 'Total Customers',
      value: stats.totalCustomers,
      subtitle: 'Registered accounts',
      icon: Users,
      href: '/customers',
      color: 'text-purple-500',
    },
    {
      title: 'Calls Today',
      value: stats.callsToday,
      subtitle: 'Since midnight',
      icon: Activity,
      href: '/calls',
      color: 'text-orange-500',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Insurance agent activity overview
          </p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.title} href={card.href} className="group">
            <div className="bg-card rounded-xl border p-6 transition-colors duration-200 hover:bg-accent/50">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {card.title}
                </span>
                <card.icon className={`size-5 ${card.color}`} />
              </div>
              <div className="mt-2 text-2xl font-bold">{card.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {card.subtitle}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent activity */}
      <div className="bg-card rounded-xl border">
        <div className="border-b px-6 py-4">
          <h2 className="text-sm font-medium">Recent Activity</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity className="size-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            Activity feed will update as calls and claims come in.
          </p>
        </div>
      </div>
    </div>
  );
}
