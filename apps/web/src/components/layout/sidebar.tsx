'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  Phone,
  FileText,
  Users,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/calls', label: 'Calls', icon: Phone },
  { href: '/claims', label: 'Claims', icon: FileText },
  { href: '/customers', label: 'Customers', icon: Users },
] as const;

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function SidebarNav({ onLinkClick }: { onLinkClick?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-5">
        <Link
          href="/dashboard"
          className="text-xl font-bold tracking-tight"
          onClick={onLinkClick}
        >
          Bella
        </Link>
        <p className="text-xs text-muted-foreground">Insurance Agent Dashboard</p>
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 px-2 py-3">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onLinkClick}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-muted font-semibold text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Separator />

      <div className="p-4">
        {session?.user ? (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarImage
                src={session.user.image ?? undefined}
                alt={session.user.name ?? 'User'}
              />
              <AvatarFallback className="text-xs">
                {getInitials(session.user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 truncate">
              <p className="truncate text-sm font-medium">
                {session.user.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {session.user.email}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => signOut({ callbackUrl: '/auth/signin' })}
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        ) : (
          <Link href="/auth/signin">
            <Button variant="outline" className="w-full">
              Sign in
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r bg-background md:block">
      <SidebarNav />
    </aside>
  );
}
