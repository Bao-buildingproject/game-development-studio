/** Display names: printable, trimmed, max 16 chars (GDD §52 input sanitation). */
export function sanitizeName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
}
