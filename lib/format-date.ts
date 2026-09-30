/**
 * Formats any user-facing date as MM/DD/YYYY. This is the single place
 * that rule lives — new date displays should import this rather than
 * calling toLocaleDateString ad hoc.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}
