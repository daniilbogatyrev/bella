import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
      icon: Phone,
      href: '/calls',
      color: 'text-green-500',
    },
    {
      title: 'Open Claims',
      value: stats.openClaims,
      icon: FileText,
      href: '/claims',
      color: 'text-blue-500',
    },
    {
      title: 'Total Customers',
      value: stats.totalCustomers,
      icon: Users,
      href: '/customers',
      color: 'text-purple-500',
    },
    {
      title: 'Calls Today',
      value: stats.callsToday,
      icon: Activity,
      href: '/calls',
      color: 'text-orange-500',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Insurance agent activity overview
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.title} href={card.href}>
            <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
