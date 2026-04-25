import type { ClaimEvent } from '@bella/db';
import Link from 'next/link';

const typeColors: Record<string, string> = {
  fact: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  observation:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  action:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  system: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

export function ClaimEventsTimeline({ events }: { events: ClaimEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No events recorded yet.</p>
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event) => (
        <div key={event.id} className="flex gap-3">
          <div className="relative flex flex-col items-center">
            <div className="size-2.5 rounded-full bg-border" />
            <div className="flex-1 w-px bg-border" />
          </div>
          <div className="flex-1 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[event.type] ?? ''}`}
              >
                {event.type}
              </span>
              <span className="text-xs text-muted-foreground">
                {event.createdAt.toLocaleString()}
              </span>
              {event.sessionId && (
                <Link
                  href={`/calls/${event.sessionId}`}
                  className="text-xs text-primary hover:underline"
                >
                  View call →
                </Link>
              )}
            </div>
            <p className="text-sm">{event.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
