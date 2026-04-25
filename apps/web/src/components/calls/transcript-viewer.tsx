'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';

interface TranscriptEntry {
  id: string;
  role: 'customer' | 'agent' | 'system' | 'tool';
  content: string;
  toolName: string | null;
  toolInput: unknown;
  toolResult: unknown;
  createdAt: Date | string;
}

interface TranscriptViewerProps {
  entries: TranscriptEntry[];
}

const systemStyle = {
  bg: 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700',
  align: 'self-center',
  label: 'System',
  textStyle: 'italic text-muted-foreground',
} as const;

const roleStyles: Record<
  string,
  { bg: string; align: string; label: string; textStyle?: string }
> = {
  customer: {
    bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
    align: 'self-start',
    label: 'Customer',
  },
  agent: {
    bg: 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800',
    align: 'self-end',
    label: 'Agent',
  },
  system: {
    bg: 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700',
    align: 'self-center',
    label: 'System',
    textStyle: 'italic text-muted-foreground',
  },
  tool: {
    bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800',
    align: 'self-start',
    label: 'Tool',
  },
};

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function ToolDetails({
  name,
  input,
  result,
}: {
  name: string;
  input: unknown;
  result: unknown;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 rounded border border-purple-200 dark:border-purple-800 bg-purple-100/50 dark:bg-purple-900/20">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
      >
        <Wrench className="size-3" />
        <span>{name}</span>
        {expanded ? (
          <ChevronDown className="ml-auto size-3" />
        ) : (
          <ChevronRight className="ml-auto size-3" />
        )}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-purple-200 dark:border-purple-800 px-3 py-2">
          {input != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                Input
              </p>
              <pre className="overflow-x-auto rounded bg-background p-2 text-xs">
                {typeof input === 'string'
                  ? input
                  : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {result != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                Output
              </p>
              <pre className="overflow-x-auto rounded bg-background p-2 text-xs">
                {typeof result === 'string'
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TranscriptViewer({ entries }: TranscriptViewerProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No transcript entries recorded for this call.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => {
        const style = roleStyles[entry.role] ?? systemStyle;
        return (
          <div
            key={entry.id}
            className={cn(
              'flex flex-col rounded-lg border px-4 py-3 max-w-[85%]',
              style.bg,
              style.align
            )}
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold">{style.label}</span>
              <span>·</span>
              <time>{formatTime(entry.createdAt)}</time>
            </div>
            <p className={cn('text-sm whitespace-pre-wrap', style.textStyle)}>
              {entry.content}
            </p>
            {entry.role === 'tool' && entry.toolName && (
              <ToolDetails
                name={entry.toolName}
                input={entry.toolInput}
                result={entry.toolResult}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
