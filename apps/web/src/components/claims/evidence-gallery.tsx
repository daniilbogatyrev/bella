import type { Evidence } from '@bella/db';
import { FileTextIcon, ImageIcon, VideoIcon } from 'lucide-react';

const statusColors: Record<string, string> = {
  pending: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  uploaded: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  verified: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

const fileTypeIcons: Record<string, React.ReactNode> = {
  photo: <ImageIcon className="size-8 text-muted-foreground" />,
  document: <FileTextIcon className="size-8 text-muted-foreground" />,
  video: <VideoIcon className="size-8 text-muted-foreground" />,
};

export function EvidenceGallery({ items }: { items: Evidence[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No evidence items yet.</p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex flex-col items-center gap-2 rounded-lg border p-4"
        >
          {fileTypeIcons[item.fileType] ?? (
            <FileTextIcon className="size-8 text-muted-foreground" />
          )}
          <span className="text-sm font-medium truncate max-w-full">
            {item.fileName ?? 'Pending Upload'}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status] ?? ''}`}
          >
            {item.status}
          </span>
        </div>
      ))}
    </div>
  );
}
