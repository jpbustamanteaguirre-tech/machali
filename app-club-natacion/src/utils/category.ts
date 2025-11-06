// src/utils/category.ts

/**
 * Opciones de categoría para filtros y selects.
 * Mantener el orden visual de menor a mayor.
 */
export const CATEGORY_OPTIONS = [
  'Menores',
  'INF E',
  'INF D',
  'INF C',
  'INF A',
  'INF B1',
  'INF B2',
  'JUV A1',
  'JUV A2',
  'JUV B',
  'MAY',
] as const;

/**
 * Obtiene el año de nacimiento desde un ISO "YYYY-MM-DD".
 */
function getBirthYear(birthISO?: string): number | null {
  if (!birthISO) return null;
  const m = birthISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * Categoría por AÑO DE NACIMIENTO respecto del seasonYear.
 * No usa día/mes: la categoría es fija todo el año.
 *
 * Regla (ej. seasonYear=2025):
 *  - <=7 años: Menores                (birthYear >= 2018)
 *  - 8:        INF E                  (2017)
 *  - 9:        INF D                  (2016)
 *  - 10:       INF C                  (2015)
 *  - 11:       INF A                  (2014)
 *  - 12:       INF B1                 (2013)
 *  - 13:       INF B2                 (2012)
 *  - 14:       JUV A1                 (2011)
 *  - 15:       JUV A2                 (2010)
 *  - 16–18:    JUV B                  (2009, 2008, 2007)
 *  - 19+:      MAY                    (<= 2006)
 *
 * Esto se generaliza como: ageYear = seasonYear - birthYear
 */
export function getCategoryFromBirthYear(birthYear: number | null, seasonYear?: number): string {
  if (birthYear == null) return '—';
  const y = seasonYear ?? new Date().getFullYear();
  const ageYear = y - birthYear; // SIN considerar mes/día

  if (ageYear <= 7) return 'Menores';
  if (ageYear === 8) return 'INF E';
  if (ageYear === 9) return 'INF D';
  if (ageYear === 10) return 'INF C';
  if (ageYear === 11) return 'INF A';
  if (ageYear === 12) return 'INF B1';
  if (ageYear === 13) return 'INF B2';
  if (ageYear === 14) return 'JUV A1';
  if (ageYear === 15) return 'JUV A2';
  if (ageYear >= 16 && ageYear <= 18) return 'JUV B';
  return 'MAY'; // ≥19
}

/**
 * Azúcar: categoría directa desde birthISO y seasonYear opcional.
 * Determinada EXCLUSIVAMENTE por año de nacimiento vs seasonYear.
 */
export function getCategory(birthISO?: string, seasonYear?: number): string {
  return getCategoryFromBirthYear(getBirthYear(birthISO), seasonYear);
}
