// src/utils/time.ts

/**
 * Máscara progresiva estable para tiempos:
 * Entrada SOLO dígitos (0-9), hasta 6 (MM SS cc):
 * 1 -> "0"
 * 2 -> "01"
 * 3 -> "01:2"
 * 4 -> "01:20"
 * 5 -> "01:20.5"
 * 6 -> "01:20.55"
 *
 * También sirve si el usuario quiere segundos con centésimas:
 *  "2698" -> "26.98" (lo verás cuando valides/serialices)
 *  Para mostrar en input siempre usamos el patrón MM:SS.cc con entrada progresiva.
 */
export function maskTimeDigitsToDisplay(raw: string): string {
  if (!raw) return '';
  const d = String(raw).replace(/\D/g, '').slice(0, 6);
  const len = d.length;

  if (len <= 2) {
    // 1-2 dígitos: solo los muestra tal cual (no rellenamos con 0 aquí)
    return d;
  }
  if (len === 3) {
    return `${d.slice(0, 2)}:${d.slice(2)}`;
  }
  if (len === 4) {
    return `${d.slice(0, 2)}:${d.slice(2, 4)}`;
  }
  if (len === 5) {
    return `${d.slice(0, 2)}:${d.slice(2, 4)}.${d.slice(4)}`;
  }
  // len === 6
  return `${d.slice(0, 2)}:${d.slice(2, 4)}.${d.slice(4, 6)}`;
}

/**
 * Convierte string a milisegundos.
 * Acepta:
 *  - "MM:SS.cc"  (p.ej. "01:20.55")
 *  - "SS.cc"     (p.ej. "26.98")
 *  - Solo dígitos: MMSScc o SScc (p.ej. "012055" -> 01:20.55, "2698" -> 26.98)
 * Retorna null si no es válido (segundos >= 60).
 */
export function timeStrToMs(str: string): number | null {
  if (!str) return null;
  const s = String(str).trim();

  // 1) MM:SS.cc
  let m = 0, sec = 0, cent = 0;
  let mobj = s.match(/^(\d{1,2}):([0-5]?\d)\.(\d{1,2})$/);
  if (mobj) {
    m = parseInt(mobj[1], 10);
    sec = parseInt(mobj[2], 10);
    cent = parseInt(mobj[3].padEnd(2, '0'), 10);
    return (m * 60 * 1000) + (sec * 1000) + (cent * 10);
  }

  // 2) SS.cc
  mobj = s.match(/^([0-5]?\d)\.(\d{1,2})$/);
  if (mobj) {
    sec = parseInt(mobj[1], 10);
    cent = parseInt(mobj[2].padEnd(2, '0'), 10);
    return (sec * 1000) + (cent * 10);
  }

  // 3) Solo dígitos -> MMSScc o SScc
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 3) {
    const cc = parseInt(digits.slice(-2), 10);      // cc
    const rest = digits.slice(0, -2);               // MMSS o SS
    if (rest.length > 2) {
      m = parseInt(rest.slice(0, -2), 10);
      sec = parseInt(rest.slice(-2), 10);
    } else {
      m = 0;
      sec = parseInt(rest, 10);
    }
    if (isNaN(sec) || sec >= 60) return null;
    return (m * 60 * 1000) + (sec * 1000) + (cc * 10);
  }

  return null;
}
