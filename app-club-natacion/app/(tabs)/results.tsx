//app\(tabs)\results.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as NavigationBar from 'expo-navigation-bar';
import { router } from 'expo-router';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { getCategory } from '../../src/utils/category';
import { maskTimeDigitsToDisplay, timeStrToMs } from '../../src/utils/time';

const BG = '#F7F8FA';
const NAVY = '#0B1E2F';
const BORDER = '#E6E8EC';
const MUTED = '#4A5A6A';
const RED = '#CE2434';
const WHITE = '#FFFFFF';
const POS = '#137333';
const NEG = '#B00020';

// === Cache keys ===
const CACHE_KEY = 'results_cache_v1';        // results + lastSync
const CACHE_ATHLETES_KEY = 'athletes_cache_v1';
const CACHE_STANDARDS_KEY = 'standards_cache_v1';

type Athlete = {
  id: string;
  name: string;
  gender?: string;
  birth?: string;
  seasonYear?: number;
  status?: 'pending' | 'active' | 'inactive';
};

type Result = {
  id: string;
  athleteId: string;
  style: string;           // Libre | Espalda | Pecho | Mariposa | Combinado
  distance: number;        // 25..1500
  poolLength?: number;     // 25 | 50
  poolLen?: number;        // alias antiguo
  seasonYear?: number;     // año deportivo
  date?: string;           // ISO YYYY-MM-DD
  timeMs?: number;
  timeStr?: string;
  updatedAt?: any;         // Firestore Timestamp (puede venir null en históricos)
};

type Standard = {
  id: string;
  seasonYear: number;
  category: string;
  gender: 'female' | 'male';
  genderDisplay: 'Mujeres' | 'Hombres';
  distance: number;
  style: 'Libre' | 'Espalda' | 'Pecho' | 'Mariposa' | 'Combinado';
  timeStr: string;
  timeMs: number | null;
};

type ResultsCacheV1 = {
  lastSync: number;   // epoch ms del último updatedAt procesado
  results: Result[];  // lite
};

// ==== Columnas ====
const STYLE_ORDER = ['Libre', 'Espalda', 'Pecho', 'Mariposa', 'Combinado'] as const;
const DIST_BY_STYLE: Record<(typeof STYLE_ORDER)[number], number[]> = {
  Libre: [25, 50, 100, 200, 400, 800, 1500],
  Espalda: [25, 50, 100, 200],
  Pecho: [25, 50, 100, 200],
  Mariposa: [25, 50, 100, 200],
  Combinado: [100, 200, 400],
};

const shortLabel = (style: string, dist: number) => {
  const s = style.toLowerCase();
  const code =
    s.startsWith('libre') ? 'L' :
    s.startsWith('espalda') ? 'E' :
    s.startsWith('pecho') ? 'P' :
    s.startsWith('mariposa') ? 'M' : 'C';
  return `${dist}${code}`;
};

const colKey = (style: string, distance: number) => `${style}-${distance}`;

const ALL_COLUMNS: Array<{ key: string; label: string; style: string; distance: number }> = (() => {
  const out: Array<{ key: string; label: string; style: string; distance: number }> = [];
  for (const st of STYLE_ORDER) {
    for (const d of DIST_BY_STYLE[st]) {
      out.push({ key: colKey(st, d), label: shortLabel(st, d), style: st, distance: d });
    }
  }
  return out;
})();

const normalizeGender = (g?: string) => {
  const s = (g || '').trim().toLowerCase();
  if (s === 'm' || s.startsWith('masc')) return 'Masculino';
  if (s === 'f' || s.startsWith('feme')) return 'Femenino';
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};

const genderDisplayFromAthlete = (g?: string): 'Mujeres' | 'Hombres' | '' => {
  const n = normalizeGender(g);
  if (n === 'Femenino') return 'Mujeres';
  if (n === 'Masculino') return 'Hombres';
  return '';
};

function toTitleCase(input?: string) {
  return (input || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// 20.36 y 1:20.25
function msToPretty(ms?: number | null): string {
  if (ms == null || !isFinite(ms)) return '—';
  const totalCs = Math.round(ms / 10);
  const sTotal = Math.floor(totalCs / 100);
  const cs = totalCs % 100;
  const m = Math.floor(sTotal / 60);
  const s = sTotal % 60;
  if (m <= 0) return `${s}.${String(cs).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
function parseTimeStrToMs(t?: string): number | null {
  if (!t) return null;
  const mm = t.match(/^(\d{1,2}):(\d{2})\.(\d{2})$/);
  if (mm) {
    const m = Number(mm[1]); const s = Number(mm[2]); const cs = Number(mm[3]);
    return (m * 60 + s) * 1000 + cs * 10;
  }
  const ss = t.match(/^(\d{1,2})\.(\d{2})$/);
  if (ss) {
    const s = Number(ss[1]); const cs = Number(ss[2]);
    return s * 1000 + cs * 10;
  }
  return null;
}
function parseYearFromISO(iso?: string): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4})-/);
  return m ? Number(m[1]) : undefined;
}

// Edad al 1/1
function calcAgeOnJan1(birthISO?: string, seasonYear?: number): number | null {
  if (!birthISO) return null;
  const m = birthISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const by = Number(m[1]), bm = Number(m[2]), bd = Number(m[3]);
  const year = seasonYear ?? new Date().getFullYear();
  let age = year - by;
  const birthdayAfterJan1 = bm > 1 || (bm === 1 && bd > 1);
  if (birthdayAfterJan1) age -= 1;
  return age;
}

type Mode = 'times' | 'progress';

// Normalizador categoría para estándares
function normalizeCategoryForStd(raw?: string): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/juvenil/g, 'juv');
  s = s.replace(/mayores?/g, 'may');
  s = s.replace(/infantil/g, 'inf');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/a\s*1\b/g, 'a1');
  s = s.replace(/a\s*2\b/g, 'a2');
  s = s.replace(/b\s*1\b/g, 'b1');
  s = s.replace(/b\s*2\b/g, 'b2');
  if (/^juv\b/.test(s)) {
    if (/\ba1\b/.test(s)) return 'Juv A1';
    if (/\ba2\b/.test(s)) return 'Juv A2';
    if (/\bb\b/.test(s))  return 'Juv B';
    return 'Juv B';
  }
  if (/^may\b/.test(s)) return 'May';
  if (/^inf\b/.test(s)) {
    if (/\bb1\b/.test(s)) return 'Inf B1';
    if (/\bb2\b/.test(s)) return 'Inf B2';
    if (/\ba\b/.test(s))  return 'Inf A';
    return 'Inf A';
  }
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function ResultsSummaryScreen() {
  useEffect(() => {
    NavigationBar.setBackgroundColorAsync(NAVY);
    NavigationBar.setButtonStyleAsync('light');
    NavigationBar.setVisibilityAsync('visible');
  }, []);

  // Datos
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [results, setResults] = useState<Result[]>([]);

  // Mínimas
  const [standards, setStandards] = useState<Standard[]>([]);
  const standardsMap = useMemo(() => {
    const m = new Map<string, Standard>();
    for (const s of standards) {
      const key = `${s.category}|${s.genderDisplay}|${s.style}|${s.distance}`;
      m.set(key, s);
    }
    return m;
  }, [standards]);

  // UI / Filtros
  const [pool25, setPool25] = useState<boolean>(true);
  const poolLength = pool25 ? 25 : 50;
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('times');
  const [onlyMinimums, setOnlyMinimums] = useState<boolean>(false);

  // Menú ☰
  const [openMenu, setOpenMenu] = useState(false);

  // Modal de mínimas
  const [openStandards, setOpenStandards] = useState(false);
  const [stdGender, setStdGender] = useState<'Mujeres' | 'Hombres'>('Mujeres');

  // Selector de categoría
  const [stdCategory, setStdCategory] = useState<string>('Juv A1');
  const [openCategoryPicker, setOpenCategoryPicker] = useState(false);

const categoriesAvail = useMemo(() => {
  const raw = standards.map(s => s?.category || '').filter(Boolean);
  const unique = Array.from(new Set(raw));
  return unique.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}, [standards]);

  const gendersAvail: Array<'Mujeres'|'Hombres'> = ['Mujeres','Hombres'];

  // Edición
  const [editingStd, setEditingStd] = useState<Standard | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  // Ordenamiento
  type SortKey = 'name' | `col:${string}` | 'total%';
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Años
  const CURRENT_YEAR = new Date().getFullYear();
  const PREV_YEAR = CURRENT_YEAR - 1;

  // =========================
  //   CARGA CACHES INICIALES
  // =========================
  useEffect(() => {
    (async () => {
      try {
        const [rawR, rawA, rawS] = await Promise.all([
          AsyncStorage.getItem(CACHE_KEY),
          AsyncStorage.getItem(CACHE_ATHLETES_KEY),
          AsyncStorage.getItem(CACHE_STANDARDS_KEY),
        ]);

try {
  if (rawA) {
    const arr = JSON.parse(rawA);
    if (Array.isArray(arr)) setAthletes(arr as Athlete[]);
  }
  if (rawS) {
    const arr = JSON.parse(rawS);
    if (Array.isArray(arr)) setStandards(arr as Standard[]);
  }
  if (rawR) {
    const obj = JSON.parse(rawR);
    if (obj && Array.isArray(obj.results)) setResults(obj.results as Result[]);
  }
} catch { /* ignora caché corrupto */ }

      } catch {}
      setLoading(false);
    })();
  }, []);

  // ===========================================
  //   SNAPSHOTS LIVIANOS: ATHLETES + STANDARDS
  //   (se cachean para arranques futuros)
  // ===========================================
  useEffect(() => {
    const ua = onSnapshot(
      collection(db, 'athletes'),
      async (snap) => {
        const arr: Athlete[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data?.status === 'inactive') return;
          arr.push({ id: d.id, ...data, name: toTitleCase(data?.name || '') });
        });
        arr.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity: 'base' }));
        setAthletes(arr);
        try { await AsyncStorage.setItem(CACHE_ATHLETES_KEY, JSON.stringify(arr)); } catch {}
      },
      () => {}
    );

    const us = onSnapshot(
      collection(db, 'qualifyingStandards'),
      async (snap) => {
        const arr: Standard[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setStandards(arr);
        try { await AsyncStorage.setItem(CACHE_STANDARDS_KEY, JSON.stringify(arr)); } catch {}
      },
      () => {}
    );

    return () => { ua(); us(); };
  }, []);

  // =======================================================
  //   DELTA UPDATES de RESULTS usando meta/results.lastUpdatedAt
  //   (si no hay cache, hace bootstrap una sola vez)
  // =======================================================
  useEffect(() => {
    let lastSyncLocal = 0;
    let unsubMeta: undefined | (() => void);

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          const obj = JSON.parse(raw) as ResultsCacheV1;
          lastSyncLocal = obj.lastSync || 0;
        }
      } catch {}

      // Escucha meta/results
      unsubMeta = onSnapshot(doc(db, 'meta', 'results'), async (snap) => {
        const ts = snap.get('lastUpdatedAt');
        const lastUpdatedAtMs = ts?.toMillis?.() ?? 0;

        // bootstrap si no hay cache (lastSync = 0)
        if (!lastSyncLocal && results.length === 0) {
          // Primera vez: trae todo (una sola lectura pesada)
const all = await getDocs(collection(db, 'results'));
const arrFull: any[] = [];
all.forEach((d) => arrFull.push({ id: d.id, ...(d.data() as any) }));
const arrLite = arrFull.map(toLite);

setResults(arrLite as any);
lastSyncLocal = lastUpdatedAtMs || Date.now();
await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ lastSync: lastSyncLocal, results: arrLite }));

        }

        // Si hay cambios posteriores al lastSync local → delta
        if (lastUpdatedAtMs > lastSyncLocal) {
          const qd = query(
            collection(db, 'results'),
            where('updatedAt', '>', new Date(lastSyncLocal)),
            orderBy('updatedAt')
          );
          const deltaSnap = await getDocs(qd);

          // Aplicar delta sobre results actuales
const map = new Map<string, Result>();
for (const r of results) map.set(r.id, r);

deltaSnap.forEach((d) => {
  const dataLite = toLite({ id: d.id, ...(d.data() as any) });
  map.set(d.id, dataLite as any);
});

const nextArr = Array.from(map.values());
setResults(nextArr as any);

await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ lastSync: lastUpdatedAtMs, results: nextArr }));


          lastSyncLocal = lastUpdatedAtMs;
          try {
            await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ lastSync: lastSyncLocal, results: nextArr } as ResultsCacheV1));
          } catch {}
        }
      });
    })();

    return () => { unsubMeta?.(); };
  }, [results.length]);

  // Índice mejores tiempos por atleta (se calcula en cliente desde results cacheados)
  type BestPerYear = Record<string /*colKey*/, { ms: number; str: string }>;
  type FirstPerYear = Record<string /*colKey*/, { ms: number; date: string }>;
  type BestMap = {
    byYear: Record<number, BestPerYear>;
    firstOfYear: Record<number, FirstPerYear>;
  };
  type ResultLite = {
  id: string;
  athleteId?: string;
  style: string;
  distance: number;
  seasonYear?: number;
  date?: string;
  timeMs?: number;
  timeStr?: string;
  updatedAt?: number; // millis
};

const toLite = (r: any): ResultLite => ({
  id: r.id,
  athleteId: r.athleteId,
  style: toTitleCase(r.style || ''),
  distance: Number(r.distance) || 0,
  seasonYear: typeof r.seasonYear === 'number' ? r.seasonYear : (parseYearFromISO(r.date) ?? undefined),
  date: r.date,
  timeMs: typeof r.timeMs === 'number' ? r.timeMs : (parseTimeStrToMs(r.timeStr || undefined) ?? undefined),
  timeStr: r.timeStr,
  updatedAt: r.updatedAt?.toMillis?.(),
});

  const bestPerAthlete: Record<string, BestMap> = useMemo(() => {
    const map: Record<string, BestMap> = {};
    for (const a of athletes) map[a.id] = { byYear: {}, firstOfYear: {} };

    for (const r of results) {
      if (!r.athleteId) continue;

      const style = toTitleCase(r.style);
      if (!STYLE_ORDER.includes(style as any)) continue;

      const distList = DIST_BY_STYLE[style as (typeof STYLE_ORDER)[number]];
      if (!distList.includes(Number(r.distance))) continue;

      const ms =
        typeof r.timeMs === 'number'
          ? r.timeMs
          : parseTimeStrToMs(r.timeStr || undefined) || undefined;
      if (ms == null) continue;

      const k = colKey(style, Number(r.distance));
      const year = (typeof r.seasonYear === 'number' ? r.seasonYear : parseYearFromISO(r.date));
      const target = map[r.athleteId] ?? (map[r.athleteId] = { byYear: {}, firstOfYear: {} });

      if (typeof year === 'number') {
        if (!target.byYear[year]) target.byYear[year] = {};
        const prev = target.byYear[year][k]?.ms;
        if (prev == null || ms < prev) {
          target.byYear[year][k] = { ms, str: r.timeStr || msToPretty(ms) };
        }
        if (!target.firstOfYear[year]) target.firstOfYear[year] = {};
        const prevFirst = target.firstOfYear[year][k];
        const d = r.date || '';
        if (!prevFirst || (d && d < prevFirst.date)) {
          target.firstOfYear[year][k] = { ms, date: d || '9999-12-31' };
        }
      } else {
        if (!target.byYear[-1]) target.byYear[-1] = {};
        const prev = target.byYear[-1][k]?.ms;
        if (prev == null || ms < prev) {
          target.byYear[-1][k] = { ms, str: r.timeStr || msToPretty(ms) };
        }
      }
    }
    return map;
  }, [athletes, results]);

  // Dataset tabla
  type Row = {
    id: string;
    name: string;
    gender?: string;
    category?: string;
    ageOnJan1?: number | null;
    cols: Record<string /*colKey*/, { ms?: number; str?: string; pct?: number }>;
    totalPct?: number | null;
    hasAnyTime?: boolean;
    hasAnyQualifying?: boolean;
    qualCount?: number;
  };

  function pickYearBucketIdx<T>(buckets: Record<number, T>) {
    const order: number[] = [
      CURRENT_YEAR,
      PREV_YEAR,
      ...Object.keys(buckets).map(Number).filter(v => v >= 0 && v !== CURRENT_YEAR && v !== PREV_YEAR).sort((a,b)=>b-a),
      -1,
    ];
    return order.find(y => buckets[y] != null);
  }

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];

    for (const a of athletes) {
      const gender = normalizeGender(a.gender);
      const category = getCategory(a.birth, a.seasonYear);
      const age = calcAgeOnJan1(a.birth, a.seasonYear);

      if (mode === 'times') {
        if (onlyMinimums) {
          // Combinar 25 + 50 para el MISMO año elegido (desde results cacheados)
          const byYearBothPools: Record<number, Record<string, { ms: number; str: string }>> = {};

          for (const r of results) {
            if (r.athleteId !== a.id) continue;

            const style = toTitleCase(r.style);
            if (!STYLE_ORDER.includes(style as any)) continue;
            if (!DIST_BY_STYLE[style as (typeof STYLE_ORDER)[number]].includes(Number(r.distance))) continue;

            const ms =
              typeof r.timeMs === 'number'
                ? r.timeMs
                : parseTimeStrToMs(r.timeStr || undefined) || undefined;
            if (ms == null) continue;

            const k = colKey(style, Number(r.distance));
            const year = (typeof r.seasonYear === 'number' ? r.seasonYear : parseYearFromISO(r.date)) ?? -1;

            if (!byYearBothPools[year]) byYearBothPools[year] = {};
            const prev = byYearBothPools[year][k]?.ms;
            if (prev == null || ms < prev) {
              byYearBothPools[year][k] = { ms, str: r.timeStr || msToPretty(ms) };
            }
          }

          const pick = pickYearBucketIdx(byYearBothPools);
          const last = (pick != null && byYearBothPools[pick]) ? byYearBothPools[pick] : {};

          const cols: Row['cols'] = {};
          let hasAnyTime = false;
          let hasAnyQualifying = false;
          let qualCount = 0;

          for (const c of ALL_COLUMNS) {
            const v = last[c.key];
            if (v) {
              hasAnyTime = true;

              const gDisp = genderDisplayFromAthlete(gender);
              const catStd = normalizeCategoryForStd(category || undefined);
              const std = gDisp && catStd ? standardsMap.get(`${catStd}|${gDisp}|${c.style}|${c.distance}`) : undefined;
              const minMs = std?.timeMs ?? null;

              if (minMs != null && isFinite(minMs) && v.ms <= minMs) {
                cols[c.key] = { ms: v.ms, str: v.str };
                hasAnyQualifying = true;
                qualCount += 1;
              }
            }
          }

          if (!hasAnyTime) continue;
          if (!hasAnyQualifying) continue;

          out.push({
            id: a.id,
            name: a.name || '—',
            gender,
            category,
            ageOnJan1: age,
            cols,
            totalPct: null,
            hasAnyTime,
            hasAnyQualifying,
            qualCount,
          });

        } else {
          const entry = bestPerAthlete[a.id];
          const buckets = entry?.byYear || {};
          const picked = pickYearBucketIdx(buckets);
          const last = (picked != null && buckets[picked]) ? buckets[picked] : {};

          let hasAnyTime = false;
          const cols: Row['cols'] = {};

          for (const c of ALL_COLUMNS) {
            const v = last[c.key];
            if (v) {
              cols[c.key] = { ms: v.ms, str: v.str };
              hasAnyTime = true;
            }
          }

          if (!hasAnyTime) continue;
          out.push({
            id: a.id,
            name: a.name || '—',
            gender,
            category,
            ageOnJan1: age,
            cols,
            totalPct: null,
            hasAnyTime,
            hasAnyQualifying: false,
            qualCount: undefined,
          });
        }

      } else {
        const entry = bestPerAthlete[a.id];
        const curBest  = entry?.byYear[CURRENT_YEAR] || {};
        const prevBest = entry?.byYear[PREV_YEAR]   || {};
        const curFirst = entry?.firstOfYear[CURRENT_YEAR] || {};

        let sum = 0, count = 0;
        let hasAnyTime = false;
        const cols: Row['cols'] = {};

        for (const c of ALL_COLUMNS) {
          const curMs = curBest[c.key]?.ms;
          const prevMs = prevBest[c.key]?.ms;
          if (curMs != null) hasAnyTime = true;

          let pct: number | undefined;
          if (curMs != null && prevMs != null && prevMs > 0) {
            pct = ((prevMs - curMs) / prevMs) * 100;
          } else if (curMs != null && curFirst[c.key]?.ms != null && curFirst[c.key]!.ms > 0) {
            const base = curFirst[c.key]!.ms;
            pct = ((base - curMs) / base) * 100;
          }

          if (pct != null) { cols[c.key] = { pct }; sum += pct; count += 1; }
          else { cols[c.key] = {}; }
        }

        if (!hasAnyTime) continue;
        const totalPct = count ? (sum / count) : null;

        out.push({
          id: a.id,
          name: a.name || '—',
          gender,
          category,
          ageOnJan1: age,
          cols,
          totalPct,
          hasAnyTime,
          hasAnyQualifying: false,
          qualCount: undefined,
        });
      }
    }

    return out;
  }, [athletes, results, bestPerAthlete, mode, onlyMinimums, standardsMap]);

  // Ordenamiento
const sortedRows = useMemo(() => {
  const base = Array.isArray(rows) ? rows : [];
  const copy = base.slice();

    copy.sort((A, B) => {
      let cmp = 0;

      if (sortKey === 'name') {
        cmp = (A.name || '').localeCompare(B.name || '', 'es', { sensitivity: 'base' });

      } else if (sortKey === 'total%') {
        const a = A.totalPct, b = B.totalPct;
        if (a == null && b == null) {
          cmp = (A.name || '').localeCompare(B.name || '', 'es', { sensitivity: 'base' });
        } else if (a == null) {
          cmp = 1;
        } else if (b == null) {
          cmp = -1;
        } else {
          cmp = (mode === 'progress') ? (b - a) : (a - b);
        }

      } else {
        const key = sortKey.slice(4);
        if (mode === 'times') {
          const a = A.cols[key]?.ms;
          const b = B.cols[key]?.ms;
          if (a == null && b == null) cmp = (A.name || '').localeCompare(B.name || '', 'es');
          else if (a == null) cmp = 1;
          else if (b == null) cmp = -1;
          else cmp = a - b;
        } else {
          const a = A.cols[key]?.pct;
          const b = B.cols[key]?.pct;
          if (a == null && b == null) cmp = (A.name || '').localeCompare(B.name || '', 'es');
          else if (a == null) cmp = 1;
          else if (b == null) cmp = -1;
          else cmp = b - a;
        }
      }

      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortAsc, mode]);

  function toggleSortByName() {
    setSortKey('name');
    setSortAsc(sortKey === 'name' ? !sortAsc : true);
  }
  function toggleSortByColumn(k: string) {
    const kk = `col:${k}` as const;
    setSortKey(kk);
    setSortAsc(sortKey === kk ? !sortAsc : true);
  }
  function toggleSortByTotalPct() {
    setSortKey('total%');
    setSortAsc(true);
  }

  // Total general (solo progreso)
  const grandAvg = useMemo(() => {
    if (mode !== 'progress') return null;
    const vals = rows.map(r => r.totalPct).filter((v): v is number => v != null && isFinite(v));
    if (!vals.length) return null;
    return vals.reduce((a,b)=>a+b,0)/vals.length;
  }, [rows, mode]);

  const headerTitle = 'Resultados · Tabla resumen';

  // Colores celdas (mínimas)
  const CELL_BG_GREEN = '#E6F4EA';
  const CELL_BG_YELLOW = '#FFF8DB';
  const CELL_BG_ORANGE = '#FFE8D9';
  const CELL_BORDER_GREEN = '#B8E2C8';
  const CELL_BORDER_YELLOW = '#FFE39A';
  const CELL_BORDER_ORANGE = '#FFC6A0';

  // Resaltado de fila
  const ROW_HL_BG = '#F2F6FF';
  const ROW_HL_BORDER = '#9BB8FF';

  function cellInfoFor(
    athleteGender: string | undefined,
    athleteCategory: string | undefined,
    style: string,
    distance: number,
    ms?: number
  ): { bg: string; border: string; minStr?: string; meets?: boolean } | null {
    if (mode !== 'times') return null;
    if (!athleteCategory || !athleteGender || ms == null) return null;

    const gDisp = genderDisplayFromAthlete(athleteGender);
    const cat = normalizeCategoryForStd(athleteCategory);
    if (!gDisp || !cat) return null;

    const std = standardsMap.get(`${cat}|${gDisp}|${style}|${distance}`);
    const minMs = typeof std?.timeMs === 'number' ? std!.timeMs : null;
if (minMs == null || !isFinite(minMs)) return null;


    if (ms <= minMs) {
      return { bg: CELL_BG_GREEN, border: CELL_BORDER_GREEN, minStr: std?.timeStr || msToPretty(minMs), meets: true };
    }

    const ratio = ms / minMs;
    if (ratio <= 1.03) {
      return { bg: CELL_BG_YELLOW, border: CELL_BORDER_YELLOW, minStr: std?.timeStr || msToPretty(minMs), meets: false };
    }
    if (ratio <= 1.05) {
      return { bg: CELL_BG_ORANGE, border: CELL_BORDER_ORANGE, minStr: std?.timeStr || msToPretty(minMs), meets: false };
    }
    return { bg: WHITE, border: BORDER, meets: false };
  }

  // Lista filtrada para modal mínimas
  const filteredStandards = useMemo(() => {
    const list = standards.filter(s => s.genderDisplay === stdGender && s.category === stdCategory);
    list.sort((a,b) => {
      const sa = STYLE_ORDER.indexOf(a.style as any);
      const sb = STYLE_ORDER.indexOf(b.style as any);
      if (sa !== sb) return sa - sb;
      return a.distance - b.distance;
    });
    return list;
  }, [standards, stdGender, stdCategory]);

  // Edición de mínima
  function openEditStd(std: Standard) {
    setEditingStd(std);
    setEditingValue(std.timeStr || '');
  }
  function closeEditStd() {
    setEditingStd(null);
    setEditingValue('');
  }
  async function saveEditStd() {
    if (!editingStd) return;
    const display = editingValue.trim();
    const ms = timeStrToMs(display);
    if (ms == null) {
      Alert.alert('Tiempo inválido', 'Usa MM:SS.cc o SS.cc (p. ej. 01:20.55 o 26.98).');
      return;
    }
    const payload: Partial<Standard> = {
      timeStr: display,
      timeMs: ms,
      // @ts-ignore
      updatedAt: serverTimestamp(),
    };
    Alert.alert(
      'Confirmar cambios',
      `¿Guardar la nueva marca mínima para ${editingStd.category} ${editingStd.genderDisplay} ${editingStd.style} ${editingStd.distance} m?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Guardar',
          style: 'destructive',
          onPress: async () => {
            try {
              await setDoc(doc(db, 'qualifyingStandards', editingStd.id), payload, { merge: true });
              closeEditStd();
            } catch (e:any) {
              Alert.alert('Error', e?.message || 'No se pudo guardar.');
            }
          }
        }
      ]
    );
  }

  // Render
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right']}>
      {/* Header NAVY con botón ☰ (menú) */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
        <View style={styles.headerRow}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>
            {headerTitle}
          </Text>
          <TouchableOpacity onPress={() => setOpenMenu(true)} activeOpacity={0.9}>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>☰</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <>
          {/* Filtros */}
          <View style={styles.filterCard}>
            {/* 1/3: Piscina (bloqueado visualmente cuando Solo mínimas) */}
            <View style={styles.filterCell}>
              <View style={[styles.toggleBox, { opacity: onlyMinimums ? 0.4 : 1 }]}>
                <TouchableOpacity
                  onPress={()=>!onlyMinimums && setPool25(true)}
                  activeOpacity={0.9}
                  style={[styles.toggleItem, pool25 && styles.toggleItemOn]}
                >
                  <Text style={[styles.toggleTxt, pool25 && styles.toggleTxtOn]}>25 m</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={()=>!onlyMinimums && setPool25(false)}
                  activeOpacity={0.9}
                  style={[styles.toggleItem, !pool25 && styles.toggleItemOn]}
                >
                  <Text style={[styles.toggleTxt, !pool25 && styles.toggleTxtOn]}>50 m</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 2/3: Modo */}
            <View style={styles.filterCell}>
              <TouchableOpacity onPress={()=>setMode(mode==='times'?'progress':'times')} style={styles.modeBtn}>
                <Text style={{ color:'#fff', fontWeight:'800' }}>
                  {mode==='times' ? 'Progreso' : 'Ver tiempos'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* 3/3: Solo mínimas */}
            <View style={styles.filterCell}>
              <View style={styles.toggleBox}>
                <TouchableOpacity
                  onPress={()=>setOnlyMinimums(false)}
                  activeOpacity={0.9}
                  style={[styles.toggleItem, !onlyMinimums && styles.toggleItemOn]}
                >
                  <Text style={[styles.toggleTxt, !onlyMinimums && styles.toggleTxtOn]}>Todas</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={()=>setOnlyMinimums(true)}
                  activeOpacity={0.9}
                  style={[styles.toggleItem, onlyMinimums && styles.toggleItemOn]}
                >
                  <Text style={[styles.toggleTxt, onlyMinimums && styles.toggleTxtOn]}>Solo mínimas</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Tabla */}
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              {/* Header tabla */}
              <View style={styles.tableHeaderRow}>
                <TouchableOpacity onPress={toggleSortByName} style={[styles.th, { width: 240, alignItems:'flex-start' }]}>
                  <Text style={styles.thTxt}>Nombre</Text>
                  <Text style={styles.metaTxt}>Categoría / Edad{onlyMinimums ? ' · Clasifica' : ''}</Text>
                </TouchableOpacity>

                {ALL_COLUMNS.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    onPress={() => toggleSortByColumn(c.key)}
                    style={[styles.th, { width: 90 }]}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.thTxt}>{c.label}</Text>
                  </TouchableOpacity>
                ))}

                {mode === 'progress' && (
                  <TouchableOpacity onPress={toggleSortByTotalPct} style={[styles.th, { width: 100 }]}>
                    <Text style={styles.thTxt}>Total %</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Filas */}
              <ScrollView>
                {sortedRows.map((row) => {
                  const highlighted = selectedRow === row.id;
                  const rowNameBg = highlighted ? '#F2F6FF' : undefined;
                  const rowNameBorder = highlighted ? '#9BB8FF' : BORDER;

                  return (
                    <TouchableOpacity
                      key={row.id}
                      activeOpacity={0.95}
                      onPress={() => setSelectedRow(highlighted ? null : row.id)}
                      style={[styles.tr]}
                    >
                      {/* Nombre + meta */}
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => setSelectedRow(row.id)}
                        style={[
                          styles.td,
                          {
                            width: 240,
                            alignItems: 'flex-start',
                            justifyContent: 'center',
                            backgroundColor: rowNameBg,
                            borderColor: rowNameBorder,
                          }
                        ]}
                      >
                        <Text style={[styles.tdTxtName, highlighted && styles.tdTxtOn]} numberOfLines={1}>
                          {row.name}
                        </Text>
                        <Text style={styles.metaTxt}>
                          {row.category ?? '—'} · {row.ageOnJan1 ?? '—'} años
                          {onlyMinimums && typeof row.qualCount === 'number' ? ` · ${row.qualCount} prueba${row.qualCount===1?'':'s'} clasifican` : ''}
                        </Text>
                      </TouchableOpacity>

                      {/* Celdas */}
                      {ALL_COLUMNS.map((c) => {
                        const cell = row.cols[c.key];
                        const ms = cell?.ms;
                        const str = cell?.str ?? (ms != null ? msToPretty(ms) : '—');

                        const info = mode === 'times'
                          ? cellInfoFor(row.gender, row.category, c.style, c.distance, ms)
                          : null;

                        const baseBg = info?.bg || WHITE;
                        const baseBr = info?.border || BORDER;

                        const bg = highlighted && baseBg === WHITE ? '#F2F6FF' : baseBg;
                        const br = highlighted ? '#9BB8FF' : baseBr;

                        return (
                          <TouchableOpacity
                            key={c.key}
                            activeOpacity={0.9}
                            onPress={() => setSelectedRow(row.id)}
                            style={[
                              styles.td,
                              {
                                width: 90,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: bg,
                                borderColor: br,
                              },
                            ]}
                          >
                            {mode === 'times' ? (
                              <>
                                <Text style={styles.tdMono}>{cell?.ms != null ? str : '—'}</Text>
                                {info?.minStr && cell?.ms != null ? (
                                  <Text style={{ color: MUTED, fontWeight: '700', fontSize: 11, marginTop: 2 }}>
                                    Min: {info.minStr}
                                  </Text>
                                ) : null}
                              </>
                            ) : (
                              <Text style={[
                                styles.tdMono,
                                {
                                  color:
                                    typeof cell?.pct === 'number'
                                      ? (cell.pct > 0 ? POS : (cell.pct < 0 ? NEG : NAVY))
                                      : NAVY,
                                  fontWeight: '900',
                                }
                              ]}>
                                {typeof cell?.pct === 'number' ? `${cell.pct.toFixed(1)}%` : '—'}
                              </Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}

                      {mode === 'progress' && (
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => setSelectedRow(row.id)}
                          style={[
                            styles.td,
                            {
                              width: 100,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: highlighted ? '#F2F6FF' : WHITE,
                              borderColor: highlighted ? '#9BB8FF' : BORDER,
                            }
                          ]}
                        >
                          <Text
                            style={[
                              styles.tdMono,
                              { fontWeight: '900', color: row.totalPct != null ? (row.totalPct > 0 ? POS : (row.totalPct < 0 ? NEG : NAVY)) : NAVY },
                            ]}
                          >
                            {row.totalPct != null ? `${row.totalPct.toFixed(1)}%` : '—'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Total general (solo progreso) */}
                {mode === 'progress' && (
                  <View style={[styles.tr, { backgroundColor: '#F7F8FA' }]}>
                    <View style={[styles.td, { width: 240, alignItems: 'flex-start', justifyContent: 'center' }]}>
                      <Text style={[styles.tdTxtName]}>Total</Text>
                      <Text style={styles.metaTxt}>Promedio general</Text>
                    </View>
                    {ALL_COLUMNS.map((c) => (
                      <View key={c.key} style={[styles.td, { width: 90, alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={styles.tdMono}>—</Text>
                      </View>
                    ))}
                    <View style={[styles.td, { width: 100, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text
                        style={[
                          styles.tdMono,
                          {
                            fontWeight: '900',
                            color: grandAvg != null ? (grandAvg > 0 ? POS : (grandAvg < 0 ? NEG : NAVY)) : NAVY,
                          },
                        ]}
                      >
                        {grandAvg != null ? `${grandAvg.toFixed(1)}%` : '—'}
                      </Text>
                    </View>
                  </View>
                )}
              </ScrollView>
            </View>
          </ScrollView>
        </>
      )}

      {/* === MODAL MENÚ ☰ === */}
      <Modal visible={openMenu} transparent animationType="fade" onRequestClose={()=>setOpenMenu(false)}>
        <Pressable style={styles.modalBackdrop} onPress={()=>setOpenMenu(false)} />
        <View style={styles.menuCard}>
          <TouchableOpacity
            onPress={() => { setOpenMenu(false); router.push('/results/relays'); }}
            style={styles.menuItem}
          >
            <Text style={styles.menuItemTxt}>Calcular relevo</Text>
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            onPress={() => { setOpenMenu(false); setOpenStandards(true); }}
            style={styles.menuItem}
          >
            <Text style={styles.menuItemTxt}>Marcas mínimas</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* === MODAL: Marcas mínimas === */}
      <Modal visible={openStandards} transparent animationType="fade" onRequestClose={()=>setOpenStandards(false)}>
        <Pressable style={styles.modalBackdrop} onPress={()=>setOpenStandards(false)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Marcas mínimas</Text>

          {/* Selección género / categoría */}
          <View style={{ flexDirection:'row', gap:8, marginTop:8 }}>
            <View style={{ flex:1 }}>
              <View style={styles.toggleBox}>
                {gendersAvail.map(g => (
                  <TouchableOpacity
                    key={g}
                    onPress={()=>setStdGender(g)}
                    style={[styles.toggleItem, stdGender===g && styles.toggleItemOn]}
                  >
                    <Text style={[styles.toggleTxt, stdGender===g && styles.toggleTxtOn]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Selector de categoría */}
            <View style={{ flex:1 }}>
              <Text style={{ color:MUTED, fontWeight:'700', marginBottom:6, marginLeft:2 }}>Categoría</Text>
              <TouchableOpacity
                onPress={()=>setOpenCategoryPicker(true)}
                style={{ borderWidth:1, borderColor:BORDER, backgroundColor:'#fff', borderRadius:10, paddingHorizontal:10, paddingVertical:10 }}
              >
                <Text style={{ color:NAVY, fontWeight:'800' }}>{stdCategory}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Lista por estilo y distancia */}
          <ScrollView style={{ marginTop:8 }}>
            {STYLE_ORDER.map(st => {
              const list = filteredStandards.filter(s => s.style === st);
              if (!list.length) return null;
              return (
                <View key={st} style={{ marginBottom: 10 }}>
                  <Text style={{ color: NAVY, fontWeight:'900', marginBottom:6 }}>{st}</Text>
                  {list.map(s => (
                    <View
                      key={s.id}
                      style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                               paddingVertical:8, paddingHorizontal:10, borderWidth:1, borderColor:BORDER, borderRadius:8, backgroundColor:'#fff', marginTop:6 }}
                    >
                      <Text style={{ color:NAVY, fontWeight:'800' }}>{s.distance} m</Text>
                      <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                        <Text style={{ color:NAVY, fontWeight:'900' }}>{s.timeStr}</Text>
                        <TouchableOpacity onPress={()=>openEditStd(s)} style={{ paddingHorizontal:10, paddingVertical:6, borderRadius:8, backgroundColor:RED }}>
                          <Text style={{ color:'#fff', fontWeight:'900' }}>Editar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              );
            })}
          </ScrollView>

          <TouchableOpacity onPress={()=>setOpenStandards(false)} style={styles.modalClose}>
            <Text style={{ color:'#fff', fontWeight:'800' }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* === SUB-MODAL: Selector de categoría === */}
      <Modal visible={openCategoryPicker} transparent animationType="fade" onRequestClose={()=>setOpenCategoryPicker(false)}>
        <Pressable style={styles.modalBackdrop} onPress={()=>setOpenCategoryPicker(false)} />
        <View style={styles.pickerCard}>
          <Text style={[styles.modalTitle, { marginBottom:8 }]}>Selecciona categoría</Text>
          <FlatList
            data={categoriesAvail}
            keyExtractor={(x)=>x}
            renderItem={({item})=>(
              <TouchableOpacity
                onPress={()=>{ setStdCategory(item); setOpenCategoryPicker(false); }}
                style={{ paddingVertical:10, paddingHorizontal:10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: BORDER }}
              >
                <Text style={{ color:NAVY, fontWeight: item===stdCategory ? '900':'800' }}>{item}</Text>
              </TouchableOpacity>
            )}
            style={{ backgroundColor:'#fff', borderRadius:10, borderWidth:1, borderColor:BORDER }}
          />
          <TouchableOpacity onPress={()=>setOpenCategoryPicker(false)} style={[styles.modalClose,{ marginTop:12 }]}>
            <Text style={{ color:'#fff', fontWeight:'800' }}>Listo</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* SUB-MODAL de edición (con máscara al tipear) */}
      <Modal visible={!!editingStd} transparent animationType="fade" onRequestClose={closeEditStd}>
        <Pressable style={styles.modalBackdrop} onPress={closeEditStd} />
        <View style={styles.modalCardSmall}>
          <Text style={styles.modalTitle}>Editar mínima</Text>
          <Text style={{ color:MUTED, marginTop:4 }}>
            {editingStd ? `${editingStd.category} · ${editingStd.genderDisplay} · ${editingStd.style} ${editingStd.distance} m` : ''}
          </Text>

          <TextInput
            value={editingValue}
            onChangeText={(txt) => setEditingValue(maskTimeDigitsToDisplay(txt))}
            placeholder="MM:SS.cc o SS.cc"
            placeholderTextColor={MUTED}
            style={{
              marginTop:10, borderWidth:1, borderColor:BORDER, borderRadius:10, padding:10, color:NAVY, backgroundColor:'#fff'
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={Platform.select({ ios:'numbers-and-punctuation', android:'numeric', default:'default' })}
          />

          <View style={{ flexDirection:'row', gap:8, marginTop:12 }}>
            <TouchableOpacity onPress={closeEditStd} style={[styles.btnPlain]}>
              <Text style={[styles.btnPlainText]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={saveEditStd} style={[styles.modeBtn,{ flex:1 }]}>
              <Text style={{ color:'#fff', fontWeight:'900' }}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    includeFontPadding: false as any,
  },

  // Filtros
  filterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    marginHorizontal: 8,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  filterCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Toggles
  toggleBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: WHITE,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  toggleItem: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
  toggleItemOn: { backgroundColor: NAVY },
  toggleTxt: { color: NAVY, fontWeight: '800' },
  toggleTxtOn: { color: '#fff', fontWeight: '900' },

  modeBtn: {
    backgroundColor: RED,
    borderRadius: 10,
    paddingHorizontal: 8,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },

  // Tabla
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: WHITE,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    marginHorizontal: 12,
    marginTop: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  th: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  thTxt: { color: NAVY, fontWeight: '900' },
  metaTxt: { color: MUTED, fontWeight: '700', fontSize: 12 },

  tr: {
    flexDirection: 'row',
    backgroundColor: WHITE,
    marginHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },

  td: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderColor: BORDER,
  },
  tdTxtName: { color: NAVY, fontWeight: '800' },
  tdTxtOn: { fontWeight: '900' },
  tdMono: { color: NAVY, fontWeight: '800', fontVariant: ['tabular-nums'] as any },

  // Modales comunes
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },

  // Modal general de mínimas
  modalCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: '10%',
    bottom: '10%',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  modalCardSmall: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '25%',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  modalTitle: { color: NAVY, fontWeight: '900' },
  modalClose: {
    alignSelf: 'center',
    marginTop: 10,
    backgroundColor: RED,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  // Menú ☰
  menuCard: {
    position: 'absolute',
    right: 16,
    top: '10%',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 6,
    minWidth: 220,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  menuItem: { paddingVertical: 10, paddingHorizontal: 12 },
  menuItemTxt: { color: NAVY, fontWeight: '900' },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, marginVertical: 2 },

  // Picker categoría
  pickerCard: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '20%',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },

  // Botón plano (cancelar)
  btnPlain: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: BORDER,
  },
  btnPlainText: {
    color: NAVY,
    fontWeight: '900',
  },
});
