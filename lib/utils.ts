/** Converte 'yyyy-MM-dd' → 'dd/MM/yyyy' */
export function fData(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
