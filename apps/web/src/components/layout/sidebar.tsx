'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  Phone,
  FileText,
  Users,
  Settings,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/calls', label: 'Calls', icon: Phone },
  { href: '/claims', label: 'Claims', icon: FileText },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
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
      {/* Logo area */}
      <div className="px-5 py-5">
        <Link
          href="/dashboard"
          className="flex items-center gap-2"
          onClick={onLinkClick}
        >
          <span
            className="inline-block h-6 w-1.5 rounded-full"
            style={{
              background: 'linear-gradient(180deg, #9B99FE 0%, #2BC8B7 100%)',
            }}
          />
          <span className="font-display text-xl font-bold tracking-tight">
            Bella
          </span>
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">
          Insurance Agent Dashboard
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onLinkClick}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-200',
                isActive
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t p-4">
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
              className="hover:bg-accent hover:text-accent-foreground rounded-md"
              onClick={() => signOut({ callbackUrl: '/login' })}
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        ) : (
          <Link href="/login">
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
    <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 flex-col border-r bg-background sm:flex">
      <SidebarNav />
    </aside>
  );
}
