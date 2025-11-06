// --- FECHA ---
// Entrada dígitos: "1" -> "1", "11" -> "11/", "111" -> "11/1", ..., "11112022" -> "11/11/2022"
export function maskDateDigitsToDisplay(raw: string) {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 8);
  const d = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  let out = d;
  if (digits.length >= 3) out += '/' + m;
  if (digits.length >= 5) out += '/' + y;
  return out;
}
export function displayDateToISO(display: string) {
  const m = (display || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}
export function isoToDisplay(iso: string) {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [_, y, mm, dd] = m;
  return `${dd}/${mm}/${y}`;
}

// --- RUT ---
export function computeRutDV(numberStr: string) {
  const body = (numberStr || '').replace(/\D/g, '');
  if (!body) return '0';
  let s = 1, m = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    s = (s + Number(body[i]) * (9 - (m++ % 6))) % 11;
  }
  return s ? String(s - 1) : 'K';
}
// Entrada progresiva segura: "1" -> "1", "11" -> "1-1", "111"->"11-1", luego puntea: "11.1-1", etc.
export function formatRutDisplay(clean: string) {
  const digits = (clean || '').replace(/[^\dkK]/g, '').toUpperCase();
  if (digits.length <= 1) return digits; // 0-1 chars: no formatear
  const body = digits.slice(0, -1).replace(/K/gi, ''); // 'K' solo válido como DV
  const dv = digits.slice(-1);
  const parts: string[] = [];
  let i = body.length;
  while (i > 3) { parts.unshift(body.slice(i - 3, i)); i -= 3; }
  if (i > 0) parts.unshift(body.slice(0, i));
  const bodyDots = parts.join('.');
  return bodyDots && dv ? `${bodyDots}-${dv}` : digits;
}
export function normalizeRutToSave(display: string) {
  const d = (display || '').replace(/[.\s]/g, '').toUpperCase();
  if (!d) return '';
  if (!d.includes('-')) {
    if (d.length <= 1) return d;
    const body = d.slice(0, -1);
    const dv = d.slice(-1);
    return `${body}-${dv}`;
  }
  return d;
}
export function validateRut(display: string) {
  const norm = normalizeRutToSave(display);
  const m = norm.match(/^(\d+)-([\dkK])$/);
  if (!m) return false;
  const [, body, dv] = m;
  const dvCalc = computeRutDV(body);
  return dvCalc === dv;
}

// --- TIEMPO ---
export function maskTimeDigitsToDisplay(raw: string) {
  const d = (raw || '').replace(/\D/g, '').slice(0, 6); // MMSScc
  const mm = d.slice(0, 2);
  const ss = d.slice(2, 4);
  const cc = d.slice(4, 6);
  if (d.length <= 2) return mm;
  if (d.length <= 4) return `${mm}:${ss}`;
  return `${mm}:${ss}.${cc}`;
}
export function timeDisplayToMs(display: string) {
  const m = (display || '').match(/^(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const [, mm, ss, cc] = m;
  const totalMs = ((Number(mm) * 60 + Number(ss)) * 1000) + Number(cc) * 10;
  return totalMs;
}
