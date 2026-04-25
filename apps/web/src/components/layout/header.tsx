'use client';

import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { SidebarNav } from '@/components/layout/sidebar';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/calls': 'Calls',
  '/claims': 'Claims',
  '/customers': 'Customers',
  '/settings': 'Settings',
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  for (const [prefix, title] of Object.entries(pageTitles)) {
    if (pathname.startsWith(`${prefix}/`)) return title;
  }
  return 'Bella';
}

export function Header() {
  const pathname = usePathname();
  const title = getPageTitle(pathname);
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav onLinkClick={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex-1">
        <h1 className="font-display text-lg font-semibold">{title}</h1>
      </div>
    </header>
  );
}
