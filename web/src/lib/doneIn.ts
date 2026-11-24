/** Calendar time from add to check-off. Empty when either stamp is missing. */
export function doneIn(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const minutes = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 1) return "Done in under a minute";
  if (minutes < 60) return minutes === 1 ? "Done in 1 minute" : `Done in ${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "Done in 1 hour" : `Done in ${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Done in 1 day" : `Done in ${days} days`;
}
