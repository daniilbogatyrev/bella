export function formatDate(date: Date | string | null): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(
  start: Date | string | null,
  end?: Date | string | null
): string {
  if (!start) return 'N/A';
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const seconds = Math.floor(
    (endDate.getTime() - startDate.getTime()) / 1000
  );
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

/** Format E.164 phone to readable: +15551234567 → +1 (555) 123-4567 */
export function formatPhone(phone: string): string {
  if (!phone) return 'Unknown';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `+${cleaned[0]} (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  return phone;
}
