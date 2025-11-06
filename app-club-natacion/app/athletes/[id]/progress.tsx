// app/athletes/[id]/progress.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as NavigationBar from 'expo-navigation-bar';
import { router, useLocalSearchParams } from 'expo-router';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Line as SvgLine,
  Text as SvgText,
} from 'react-native-svg';

import TitleBar from '../../../src/components/TitleBar';
import { db } from '../../../src/services/firebase';
import { getCategory as getCategoryFromUtils } from '../../../src/utils/category';
import { displayDateToISO, maskDateDigitsToDisplay } from '../../../src/utils/format';

const NAVY = '#0B1E2F';
const RED = '#CE2434';
const GREEN = '#16A34A';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';
const MUTED = '#4A5A6A';
const WHITE = '#FFFFFF';
const MIN_LINE = '#7C3AED';
const TREND_LINE = '#3B82F6';

type Result = {
  style: string;
  distance: number;
  timeMs?: number;
  timeStr?: string;
  date?: string;        // ISO
  dateDisplay?: string; // DD/MM/AAAA
  origin?: 'Training' | 'Race';
  eventName?: string;
  poolLength?: 25 | 50;
};

type AthleteDoc = {
  name?: string;
  birth?: string;
  seasonYear?: number;
  gender?: string;
  status?: string;
};

const STYLE_ORDER = ['Libre', 'Espalda', 'Pecho', 'Mariposa', 'Combinado'] as const;
const DIST_BY_STYLE: Record<string, number[]> = {
  Libre: [25, 50, 100, 200, 400, 800, 1500],
  Espalda: [25, 50, 100, 200],
  Pecho: [25, 50, 100, 200],
  Mariposa: [25, 50, 100, 200],
  Combinado: [100, 200, 400],
};

const screenW = Dimensions.get('window').width;

const toTitleCase = (s?: string) =>
  (s ?? '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');

const keyOf = (style: string, distance: number) => `${toTitleCase(style)}|${distance}`;
const parseYear = (iso?: string) => (iso?.slice(0, 4) ? Number(iso.slice(0, 4)) : undefined);

// ==== Caché
const K_NAME = (athId: string) => `ath_prog_name_v9:${athId}`;
const K_RESULTS = (athId: string) => `ath_prog_results_v9:${athId}`;
const K_PROFILE = (athId: string) => `ath_prog_profile_v9:${athId}`;

// ==== Helpers
function normalizeGender(g?: string) {
  const v = (g || '').toString().trim().toLowerCase();
  if (['m', 'male', 'masculino', 'hombre'].includes(v)) return 'male';
  if (['f', 'female', 'femenino', 'mujer'].includes(v)) return 'female';
  return 'male';
}
function normalizeCategoryForStandards(birth?: string, seasonYear?: number) {
  const cat = getCategoryFromUtils(birth, seasonYear);
  return toTitleCase(cat.replace(/\s+/g, ' ').trim());
}
function calcAgeYears(birth?: string) {
  if (!birth) return '—';
  const m = birth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '—';
  const [_, y, mm, dd] = m;
  const bd = new Date(Number(y), Number(mm) - 1, Number(dd));
  const now = new Date();
  let age = now.getFullYear() - bd.getFullYear();
  const mdiff = now.getMonth() - bd.getMonth();
  if (mdiff < 0 || (mdiff === 0 && now.getDate() < bd.getDate())) age--;
  return String(Math.max(0, age));
}
function mmsscc(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const cc = Math.floor((total % 1000) / 10);
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}
function secsToPretty(secs: number) {
  const ms = Math.round(secs * 1000);
  return mmsscc(ms);
}
function formatISOasDDMM(iso?: string) {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mm, dd] = m;
  return `${dd}/${mm}/${y}`;
}
function fmtTickDateShort(d: Date) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}
function genLinearTicks(min: number, max: number, n: number) {
  const arr: number[] = [];
  const step = (max - min) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) arr.push(min + i * step);
  return arr;
}

export default function AthleteProgress() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const athId = String(id || '');

  const [athleteName, setAthleteName] = useState<string>('Nadador');
  const [profile, setProfile] = useState<AthleteDoc | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);

  // ==== Filtros
  const [styleSel, setStyleSel] = useState<typeof STYLE_ORDER[number]>('Libre');
  const [distSel, setDistSel] = useState<number>(50);
  const [poolSel, setPoolSel] = useState<25 | 50>(25);

  const [openStyle, setOpenStyle] = useState(false);
  const [openDist, setOpenDist] = useState(false);

  // KPI última competencia filtrada
  const [lastRaceFiltered, setLastRaceFiltered] = useState<{ date?: string; time?: string } | null>(null);

  // ===== Proyección
  const [projOpen, setProjOpen] = useState(false);
  const [projDisplay, setProjDisplay] = useState<string>(''); // DD/MM/AAAA
  const [projISO, setProjISO] = useState<string | null>(null);
  const [projMs, setProjMs] = useState<number | null>(null);

  // Debounce caché
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = (key: string, value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(key, value).catch(() => {});
    }, 250);
  };

  useEffect(() => {
    NavigationBar.setBackgroundColorAsync(NAVY);
    NavigationBar.setButtonStyleAsync('light');
    NavigationBar.setVisibilityAsync('visible');
  }, []);

  // Hidratar caché
  useEffect(() => {
    let cancelled = false;
    if (!athId) return;
    (async () => {
      try {
        const [nameSaved, resultsSaved, profileSaved] = await Promise.all([
          AsyncStorage.getItem(K_NAME(athId)),
          AsyncStorage.getItem(K_RESULTS(athId)),
          AsyncStorage.getItem(K_PROFILE(athId)),
        ]);
        if (cancelled) return;
        if (nameSaved?.trim()) setAthleteName(nameSaved);
        if (profileSaved) setProfile(JSON.parse(profileSaved) as AthleteDoc);
        if (resultsSaved) {
          const arr = JSON.parse(resultsSaved) as Result[];
          setResults(Array.isArray(arr) ? arr : []);
          setLoading(false);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [athId]);

  // Perfil + resultados (ASC)
  useEffect(() => {
    if (!athId) return;

    (async () => {
      try {
        const s = await getDoc(doc(db, 'athletes', athId));
        const data = (s.data() || {}) as AthleteDoc;
        const nm = toTitleCase(data?.name ?? 'Nadador');
        setAthleteName(nm);
        setProfile(data);
        debouncedSave(K_NAME(athId), nm);
        debouncedSave(K_PROFILE(athId), JSON.stringify(data));
      } catch {}
    })();

    const qy = query(
      collection(db, 'results'),
      where('athleteId', '==', athId),
      orderBy('date', 'asc')
    );
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr: Result[] = [];
        snap.forEach((d) => arr.push(d.data() as any));
        setResults(arr);
        setLoading(false);
        debouncedSave(K_RESULTS(athId), JSON.stringify(arr));
      },
      () => setLoading(false)
    );
    return unsub;
  }, [athId]);

  const nowYear = new Date().getFullYear();
  const prevYear = nowYear - 1;

  // ===== % MEJORA TOTAL (misma lógica que /app/(tabs)/results.tsx)
  const totalImprovePct = useMemo(() => {
    const bestByYear: Record<number, Record<string, number>> = {};
    const firstOfYear: Record<number, Record<string, { ms: number; date: string }>> = {};

    for (const r of results) {
      if (typeof r.timeMs !== 'number') continue;
      const y = parseYear(r.date);
      if (typeof y !== 'number') continue;
      const k = keyOf(r.style, Number(r.distance));
      bestByYear[y] = bestByYear[y] || {};
      const prev = bestByYear[y][k];
      if (prev == null || r.timeMs < prev) bestByYear[y][k] = r.timeMs;

      firstOfYear[y] = firstOfYear[y] || {};
      const prevF = firstOfYear[y][k];
      const d = r.date || '9999-12-31';
      if (!prevF || d < prevF.date) firstOfYear[y][k] = { ms: r.timeMs, date: d };
    }

    const cur = bestByYear[nowYear] || {};
    const prev = bestByYear[prevYear] || {};
    const firstCur = firstOfYear[nowYear] || {};

    const pcts: number[] = [];
    for (const k of Object.keys(cur)) {
      const curMs = cur[k]!;
      const prevMs = prev[k];
      if (prevMs != null && prevMs > 0) {
        pcts.push(((prevMs - curMs) / prevMs) * 100);
      } else if (firstCur[k]?.ms != null && firstCur[k]!.ms > 0) {
        const base = firstCur[k]!.ms;
        pcts.push(((base - curMs) / base) * 100);
      }
    }
    return pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
  }, [results, nowYear, prevYear]);

  // ===== Datos de la prueba filtrada
  const filteredAll = useMemo(() => {
    return results
      .filter(
        (r) =>
          toTitleCase(r.style) === toTitleCase(styleSel) &&
          Number(r.distance) === Number(distSel) &&
          typeof r.timeMs === 'number' &&
          (r.poolLength == null || r.poolLength === poolSel)
      )
      .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''))); // antiguo → nuevo
  }, [results, styleSel, distSel, poolSel]);

  // Mejor “global” de la prueba filtrada
  const bestFilteredMs = useMemo(
    () => (filteredAll.length ? Math.min(...filteredAll.map((r) => r.timeMs as number)) : null),
    [filteredAll]
  );

  // KPI: última competencia (prioriza Race, y del filtro)
  useEffect(() => {
    if (!filteredAll.length) {
      setLastRaceFiltered(null);
      return;
    }
    const races = filteredAll.filter((r) => r.origin === 'Race');
    const src = races.length ? races : filteredAll;
    const last = src[src.length - 1];
    setLastRaceFiltered({
      date: last.dateDisplay ?? formatISOasDDMM(last.date),
      time: last.timeStr ?? (typeof last.timeMs === 'number' ? mmsscc(last.timeMs) : '—'),
    });
  }, [filteredAll]);

  // ===== Mínima QS (por estilo/distancia/piscina)
  const [minMs, setMinMs] = useState<number | null>(null);
  const [minStr, setMinStr] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMin() {
      setMinMs(null);
      setMinStr(null);
      if (!profile?.seasonYear) return;
      const gender = normalizeGender(profile?.gender);
      const catStd = normalizeCategoryForStandards(profile?.birth, profile?.seasonYear);
      const base = collection(db, 'qualifyingStandards');

      let q1 = query(
        base,
        where('seasonYear', '==', profile.seasonYear),
        where('category', '==', catStd),
        where('gender', '==', gender),
        where('style', '==', toTitleCase(styleSel)),
        where('distance', '==', distSel),
        where('poolLength', '==', poolSel),
        limit(1)
      );
      let snap = await getDocs(q1);
      if (snap.empty) {
        const q2 = query(
          base,
          where('seasonYear', '==', profile.seasonYear),
          where('category', '==', catStd),
          where('gender', '==', gender),
          where('style', '==', toTitleCase(styleSel)),
          where('distance', '==', distSel),
          limit(1)
        );
        snap = await getDocs(q2);
      }
      if (!snap.empty) {
        const d = snap.docs[0].data() as any;
        if (typeof d.timeMs === 'number') {
          setMinMs(d.timeMs);
          setMinStr(d.timeStr ?? mmsscc(d.timeMs));
        }
      }
    }
    fetchMin();
  }, [profile?.seasonYear, profile?.gender, profile?.birth, styleSel, distSel, poolSel]);

  // ===== Serie / Gráfico (antiguo → nuevo) + regresión
  const {
    latestYear,
    seriesLatestYear,
    chartModel,
    trendLine,
    bestLine,
    minLine,
    improvePctEvent,
    lastPoint,
    regression, // { m,b,t0,minDate,maxDate }
  } = useMemo(() => {
    // último año de la prueba filtrada
    let lastY = -Infinity;
    for (const r of filteredAll) {
      const y = parseYear(r.date);
      if (y && y > lastY) lastY = y;
    }
    const latestY = lastY === -Infinity ? undefined : lastY;

    const series =
      latestY == null
        ? []
        : filteredAll.filter((r) => parseYear(r.date) === latestY).map((r) => {
            const secs = Math.round((r.timeMs as number) / 10) / 100;
            return { xDate: r.date ? new Date(r.date) : new Date(latestY, 0, 1), ySecs: secs, r };
          });

    // (AJUSTE: más ancho, extra a la derecha y scroll cómodo)
    const chartPadding = { l: 66, r: 32, t: 22, b: 46 };
    const baseW = Math.max(360, screenW - 24);
    const extraRight = 36;
    const pointsW = Math.max(0, series.length * 72);
    const chartW = Math.max(baseW, chartPadding.l + chartPadding.r + pointsW + extraRight);
    const chartH = 280;
    const innerW = chartW - chartPadding.l - chartPadding.r;
    const innerH = chartH - chartPadding.t - chartPadding.b;

    let model: any = null;
    let trend: { x1: number; y1: number; x2: number; y2: number } | null = null;
    let best: { y: number; label: string } | null = null;
    let minL: { y: number; label: string } | null = null;
    let lastPt: { x: number; y: number; label: string } | null = null;

    if (series.length && innerW > 0 && innerH > 0) {
      const minDate = new Date(Math.min(...series.map((p) => p.xDate.getTime())));
      const maxDate = new Date(Math.max(...series.map((p) => p.xDate.getTime())));
      const dx = maxDate.getTime() - minDate.getTime() || 1;

      const rawMinY = Math.min(...series.map((p) => p.ySecs));
      const rawMaxY = Math.max(...series.map((p) => p.ySecs));
      const span = Math.max(0.001, rawMaxY - rawMinY);
      const pad = Math.max(span * 0.3, 0.1);
      const yMin = rawMinY - pad;
      const yMax = rawMaxY + pad;
      const dy = yMax - yMin || 1;

      const x = (d: Date) => chartPadding.l + ((d.getTime() - minDate.getTime()) / dx) * innerW;
      const y = (v: number) => chartPadding.t + (1 - (v - yMin) / dy) * innerH;

      const pathPoints = series.map((p) => `${x(p.xDate)},${y(p.ySecs)}`);
      const pathD = series.length >= 2 ? pathPoints.map((p, i) => `${i ? 'L' : 'M'}${p}`).join(' ') : '';

      const areaD =
        series.length >= 2
          ? `M${x(series[0].xDate)},${y(series[0].ySecs)} ` +
            series.map((p) => `L${x(p.xDate)},${y(p.ySecs)}`).join(' ') +
            ` L${x(series[series.length - 1].xDate)},${chartH - chartPadding.b}` +
            ` L${x(series[0].xDate)},${chartH - chartPadding.b} Z`
          : '';

      const yTicksVals = genLinearTicks(yMin, yMax, 4);
      const yTicks = yTicksVals.map((v) => ({ value: secsToPretty(v), pos: y(v) }));

      const xTicks: { value: string; pos: number; raw: Date }[] = [];
      const N = series.length;
      const maxTicks = Math.min(6, N);
      const step = Math.max(1, Math.floor(N / maxTicks));
      for (let i = 0; i < N; i += step) {
        const d = series[i].xDate;
        xTicks.push({ value: fmtTickDateShort(d), pos: x(d), raw: d });
      }
      const lastD = series[N - 1].xDate;
      if (
        !xTicks.length ||
        Math.abs(xTicks[xTicks.length - 1].raw.getTime() - lastD.getTime()) > 12 * 3600 * 1000
      ) {
        xTicks.push({ value: fmtTickDateShort(lastD), pos: x(lastD), raw: lastD });
      }
      // Forzar que primer/último tick no se corten
      if (xTicks.length) {
        const first = xTicks[0];
        const last = xTicks[xTicks.length - 1];
        if (first.pos < chartPadding.l) first.pos = chartPadding.l;
        if (last.pos > chartW - chartPadding.r) last.pos = chartW - chartPadding.r;
      }

      // Regresión (tendencia) sobre este año
      if (series.length >= 2) {
        const t0 = series[0].xDate.getTime();
        const xs = series.map((p) => (p.xDate.getTime() - t0) / 86400000);
        const ys = series.map((p) => p.ySecs);
        const n = xs.length;
        const sumX = xs.reduce((a, b) => a + b, 0);
        const sumY = ys.reduce((a, b) => a + b, 0);
        const sumXY = xs.reduce((acc, xi, i) => acc + xi * ys[i], 0);
        const sumXX = xs.reduce((acc, xi) => acc + xi * xi, 0);
        const denom = n * sumXX - sumX * sumX || 1;
        const m = (n * sumXY - sumX * sumY) / denom;
        const b = (sumY - m * sumX) / n;

        const yMinFit = m * 0 + b;
        const yMaxFit = m * ((maxDate.getTime() - t0) / 86400000) + b;
        trend = { x1: x(minDate), y1: y(yMinFit), x2: x(maxDate), y2: y(yMaxFit) };

        (trend as any).t0 = t0;
        (trend as any).minDate = minDate;
        (trend as any).maxDate = maxDate;
      }

      if (filteredAll.length) {
        const bestSecs = Math.min(
          ...filteredAll.map((r) => Math.round((r.timeMs as number) / 10) / 100)
        );
        best = { y: y(bestSecs), label: `Mejor marca · ${secsToPretty(bestSecs)}` };
      }

      if (minMs != null) {
        const minSecs = Math.round(minMs / 10) / 100;
        minL = { y: y(minSecs), label: `Mínima · ${minStr ?? mmsscc(minMs)}` };
      }

      const last = series[series.length - 1];
      lastPt = { x: x(last.xDate), y: y(last.ySecs), label: secsToPretty(last.ySecs) };

      model = { chartW, chartH, chartPadding, x, y, pathD, areaD, yTicks, xTicks };
    }

    let improvePctEvent = 0;
    if (filteredAll.length >= 2) {
      const first = filteredAll[0].timeMs as number;
      const bestMs = Math.min(...filteredAll.map((r) => r.timeMs as number));
      if (first > 0 && bestMs > 0 && bestMs < first) improvePctEvent = ((first - bestMs) / first) * 100;
    }

    return {
      latestYear: latestY,
      seriesLatestYear: series,
      chartModel: model,
      trendLine: trend,
      bestLine: best,
      minLine: minL,
      improvePctEvent,
      lastPoint: lastPt,
      regression: trend
        ? {
            m: (trend as any).x1 !== undefined ? ((trend as any).m ?? 0) : 0, // placeholder no usado
            b: 0, // no se usa fuera (mantener shape)
            t0: (trend as any).t0 ?? series[0]?.xDate.getTime() ?? Date.now(),
            minDate: (trend as any).minDate ?? new Date(),
            maxDate: (trend as any).maxDate ?? new Date(),
          }
        : null,
    };
  }, [filteredAll, minMs, minStr]);

  // Distancias por estilo
  const distsForStyle = useMemo(() => DIST_BY_STYLE[styleSel] || [], [styleSel]);
  useEffect(() => {
    const arr = DIST_BY_STYLE[styleSel] || [];
    if (!arr.includes(distSel)) setDistSel(arr[0]);
  }, [styleSel]);

  const categoryDisplay = normalizeCategoryForStandards(profile?.birth, profile?.seasonYear);
  const ageReal = calcAgeYears(profile?.birth);
  const bestOfHistoryMs = useMemo(
    () => (filteredAll.length ? Math.min(...filteredAll.map((r) => r.timeMs as number)) : null),
    [filteredAll]
  );

  // ===== Proyección: inicializar con +30 días si hay datos
  useEffect(() => {
    // No dependemos de regression.m/b (no se exponen), solo de rango temporal (t0,min/max en trendLine)
    if (!trendLine || !seriesLatestYear.length) {
      setProjISO(null);
      setProjDisplay('');
      setProjMs(null);
      return;
    }
    const base = (trendLine as any).maxDate || new Date();
    const d = new Date(base.getTime() + 30 * 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    const disp = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(
      2,
      '0'
    )}/${d.getFullYear()}`;
    setProjISO(iso);
    setProjDisplay(disp);

    // Estimar con recta: reconstruimos m,b localmente
    const t0 = seriesLatestYear[0].xDate.getTime();
    const xs = seriesLatestYear.map((p) => (p.xDate.getTime() - t0) / 86400000);
    const ys = seriesLatestYear.map((p) => p.ySecs);
    if (xs.length >= 2) {
      const n = xs.length;
      const sumX = xs.reduce((a, b) => a + b, 0);
      const sumY = ys.reduce((a, b) => a + b, 0);
      const sumXY = xs.reduce((acc, xi, i) => acc + xi * ys[i], 0);
      const sumXX = xs.reduce((acc, xi) => acc + xi * xi, 0);
      const denom = n * sumXX - sumX * sumX || 1;
      const m = (n * sumXY - sumX * sumY) / denom;
      const b = (sumY - m * sumX) / n;

      const days = (d.getTime() - t0) / 86400000;
      const secs = m * days + b;
      setProjMs(Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : null);
    } else {
      setProjMs(null);
    }
  }, [trendLine, seriesLatestYear]);

  // Recalcular proyección cuando cambia fecha objetivo
  useEffect(() => {
    if (!projISO || !seriesLatestYear.length) {
      setProjMs(null);
      return;
    }
    const mIso = projISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!mIso) {
      setProjMs(null);
      return;
    }
    const d = new Date(Number(mIso[1]), Number(mIso[2]) - 1, Number(mIso[3]));
    const t0 = seriesLatestYear[0].xDate.getTime();
    const xs = seriesLatestYear.map((p) => (p.xDate.getTime() - t0) / 86400000);
    const ys = seriesLatestYear.map((p) => p.ySecs);
    if (xs.length >= 2) {
      const n = xs.length;
      const sumX = xs.reduce((a, b) => a + b, 0);
      const sumY = ys.reduce((a, b) => a + b, 0);
      const sumXY = xs.reduce((acc, xi, i) => acc + xi * ys[i], 0);
      const sumXX = xs.reduce((acc, xi) => acc + xi * xi, 0);
      const denom = n * sumXX - sumX * sumX || 1;
      const m = (n * sumXY - sumX * sumY) / denom;
      const b = (sumY - m * sumX) / n;

      const days = (d.getTime() - t0) / 86400000;
      const secs = m * days + b;
      setProjMs(Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : null);
    } else {
      setProjMs(null);
    }
  }, [projISO, seriesLatestYear]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      <TitleBar title={`Progreso · ${athleteName}`} onPressBack={() => router.back()} showBack />

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator />
          <Text style={{ color: MUTED, marginTop: 10 }}>Cargando progreso…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: Math.max(8, insets.bottom) }}
          showsVerticalScrollIndicator={false}
        >
          {/* HERO */}
          <View style={styles.heroCard}>
            <Text style={styles.heroName} numberOfLines={2}>
              {athleteName}
            </Text>
            <Text style={styles.heroLine}>
              Categoría: <Text style={styles.strong}>{categoryDisplay}</Text>
            </Text>
            <Text style={styles.heroLine}>
              Temporada: <Text style={styles.strong}>{profile?.seasonYear ?? '—'}</Text> · Edad real:{' '}
              <Text style={styles.strong}>{ageReal}</Text>
            </Text>
            <Text style={styles.heroLine}>
              % de mejora total:{' '}
              <Text style={styles.strong}>
                {`${totalImprovePct >= 0 ? '+' : ''}${totalImprovePct.toFixed(1)}%`}
              </Text>
            </Text>
          </View>

          {/* FILTROS (3 columnas; piscina como switch 25/50) */}
          <View style={styles.filtersRow}>
            {/* Estilo */}
            <TouchableOpacity style={styles.select} onPress={() => setOpenStyle(true)} activeOpacity={0.9}>
              <Text style={styles.selectLabel}>Estilo</Text>
              <Text style={styles.selectValue} numberOfLines={1}>
                {styleSel}
              </Text>
            </TouchableOpacity>

            {/* Distancia */}
            <TouchableOpacity style={styles.select} onPress={() => setOpenDist(true)} activeOpacity={0.9}>
              <Text style={styles.selectLabel}>Distancia</Text>
              <Text style={styles.selectValue} numberOfLines={1}>
                {distSel} m
              </Text>
            </TouchableOpacity>

            {/* Piscina (switch segmentado) */}
            <View style={styles.select}>
              <Text style={styles.selectLabel}>Piscina</Text>
              <View style={styles.poolSwitch}>
                <TouchableOpacity
                  onPress={() => setPoolSel(25)}
                  activeOpacity={0.9}
                  style={[styles.poolSeg, poolSel === 25 && styles.poolSegOn]}
                >
                  <Text style={[styles.poolSegTxt, poolSel === 25 && styles.poolSegTxtOn]}>25 m</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setPoolSel(50)}
                  activeOpacity={0.9}
                  style={[styles.poolSeg, poolSel === 50 && styles.poolSegOn]}
                >
                  <Text style={[styles.poolSegTxt, poolSel === 50 && styles.poolSegTxtOn]}>50 m</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* KPIs */}
          <View style={styles.kpisRow}>
            <View style={[styles.kpiCard, { backgroundColor: '#EAF6EF', borderColor: '#CFEEDD' }]}>
              <Text style={styles.kpiTitle}>Mejor global (filtro)</Text>
              <Text style={[styles.kpiValueBig, { color: GREEN }]} numberOfLines={1}>
                {bestFilteredMs != null ? mmsscc(bestFilteredMs) : '—'}
              </Text>
            </View>

            <View style={[styles.kpiCard, { backgroundColor: '#FFE9EB', borderColor: '#FFD4D8' }]}>
              <Text style={styles.kpiTitle}>Última competencia (filtro)</Text>
              <Text style={[styles.kpiValueBig, { color: RED }]} numberOfLines={1}>
                {lastRaceFiltered?.time ?? '—'}
              </Text>
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {lastRaceFiltered?.date ?? '—'}
              </Text>
            </View>

            <View style={[styles.kpiCard, { backgroundColor: '#F0E9FF', borderColor: '#E3D9FF' }]}>
              <Text style={styles.kpiTitle}>Mínima (QS)</Text>
              <Text style={[styles.kpiValueBig, { color: MIN_LINE }]} numberOfLines={1}>
                {minStr ?? (minMs != null ? mmsscc(minMs) : '—')}
              </Text>
            </View>
          </View>

          {/* % Mejora específica */}
          <View style={[styles.card, { marginTop: 12 }]}>
            <Text style={styles.cardTitle}>
              % de mejora en {styleSel} {distSel} m (histórico):{' '}
              <Text style={{ color: RED, fontWeight: '900' }}>
                {`${improvePctEvent >= 0 ? '+' : ''}${improvePctEvent.toFixed(1)}%`}
              </Text>
            </Text>
          </View>

          {/* Gráfico */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Evolución {styleSel} · {distSel} m ({latestYear ?? '—'}) · Piscina {poolSel} m
            </Text>

            {!chartModel ? (
              <Text style={{ color: MUTED, marginTop: 6 }}>Sin datos para graficar.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                bounces
                overScrollMode="always"
                contentContainerStyle={{
                  minWidth: chartModel.chartW,
                  paddingRight: 8,
                }}
                style={{ maxWidth: '100%' }}
              >
                <Svg width={chartModel.chartW} height={chartModel.chartH}>
                  <Defs>
                    <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor="#CE2434" stopOpacity="0.16" />
                      <Stop offset="1" stopColor="#CE2434" stopOpacity="0.02" />
                    </LinearGradient>
                  </Defs>
                  <Rect x="0" y="0" width={chartModel.chartW} height={chartModel.chartH} fill="#FFFFFF" />

                  {/* Ejes */}
                  <G>
                    <SvgLine
                      x1={chartModel.chartPadding.l}
                      y1={chartModel.chartPadding.t}
                      x2={chartModel.chartPadding.l}
                      y2={chartModel.chartH - chartModel.chartPadding.b}
                      stroke="#C9D1DB"
                      strokeWidth={1}
                    />
                    <SvgLine
                      x1={chartModel.chartPadding.l}
                      y1={chartModel.chartH - chartModel.chartPadding.b}
                      x2={chartModel.chartW - chartModel.chartPadding.r}
                      y2={chartModel.chartH - chartModel.chartPadding.b}
                      stroke="#C9D1DB"
                      strokeWidth={1}
                    />
                  </G>

                  {/* Grid + ticks */}
                  {chartModel.yTicks.map((t: any, i: number) => (
                    <G key={`yt-${i}`}>
                      <SvgLine
                        x1={chartModel.chartPadding.l}
                        y1={t.pos}
                        x2={chartModel.chartW - chartModel.chartPadding.r}
                        y2={t.pos}
                        stroke="#E8EEF6"
                        strokeWidth={1}
                      />
                      <SvgText
                        x={chartModel.chartPadding.l - 8}
                        y={t.pos + 4}
                        fontSize="10"
                        fill={NAVY}
                        textAnchor="end"
                      >
                        {t.value}
                      </SvgText>
                    </G>
                  ))}
                  {chartModel.xTicks.map((t: any, i: number) => (
                    <G key={`xt-${i}`}>
                      <SvgText
                        x={t.pos}
                        y={chartModel.chartH - chartModel.chartPadding.b + 18}
                        fontSize="10"
                        fill={NAVY}
                        textAnchor="end"
                        transform={`rotate(-35 ${t.pos},${chartModel.chartH - chartModel.chartPadding.b + 18})`}
                      >
                        {t.value}
                      </SvgText>
                    </G>
                  ))}

                  {/* Área + línea serie */}
                  {chartModel.areaD ? <Path d={chartModel.areaD} fill="url(#areaGrad)" /> : null}
                  {!!chartModel.pathD && <Path d={chartModel.pathD} stroke={NAVY} strokeWidth={2.5} fill="none" />}

                  {/* Puntos */}
                  {seriesLatestYear.map((p: any, i: number) => (
                    <G key={`pt-${i}`}>
                      <Circle cx={chartModel.x(p.xDate)} cy={chartModel.y(p.ySecs)} r={5} fill="#fff" />
                      <Circle cx={chartModel.x(p.xDate)} cy={chartModel.y(p.ySecs)} r={3.6} fill={RED} />
                    </G>
                  ))}

                  {/* Mejor y mínima */}
                  {bestLine && (
                    <>
                      <SvgLine
                        x1={chartModel.chartPadding.l}
                        y1={bestLine.y}
                        x2={chartModel.chartW - chartModel.chartPadding.r}
                        y2={bestLine.y}
                        stroke={GREEN}
                        strokeWidth={1.8}
                      />
                      <SvgText
                        x={chartModel.chartW - chartModel.chartPadding.r}
                        y={bestLine.y - 6}
                        fontSize="10"
                        fill={GREEN}
                        textAnchor="end"
                      >
                        {bestLine.label}
                      </SvgText>
                    </>
                  )}
                  {minLine && (
                    <>
                      <SvgLine
                        x1={chartModel.chartPadding.l}
                        y1={minLine.y}
                        x2={chartModel.chartW - chartModel.chartPadding.r}
                        y2={minLine.y}
                        stroke={MIN_LINE}
                        strokeWidth={1.6}
                        strokeDasharray="6 6"
                      />
                      <SvgText
                        x={chartModel.chartW - chartModel.chartPadding.r}
                        y={minLine.y - 6}
                        fontSize="10"
                        fill={MIN_LINE}
                        textAnchor="end"
                      >
                        {minLine.label}
                      </SvgText>
                    </>
                  )}

                  {/* Tendencia */}
                  {trendLine && (
                    <SvgLine
                      x1={trendLine.x1}
                      y1={trendLine.y1}
                      x2={trendLine.x2}
                      y2={trendLine.y2}
                      stroke={TREND_LINE}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                    />
                  )}

                  {/* Último punto */}
                  {lastPoint && (
                    <>
                      <Circle cx={lastPoint.x} cy={lastPoint.y} r={6.5} fill="#fff" />
                      <Circle cx={lastPoint.x} cy={lastPoint.y} r={4.2} fill={RED} />
                      <SvgText x={lastPoint.x + 8} y={lastPoint.y - 8} fontSize="11" fill={NAVY}>
                        Última: {lastPoint.label}
                      </SvgText>
                    </>
                  )}
                </Svg>
              </ScrollView>
            )}

            <View style={{ flexDirection: 'row', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
              <LegendDot color={NAVY} label="Serie" />
              <LegendDot color={RED} label="Puntos" />
              <LegendDot color={TREND_LINE} dash label="Tendencia" />
              <LegendDot color={GREEN} label="Mejor marca" />
              <LegendDot color={MIN_LINE} dash label="Mínima QS" />
            </View>

            <Text style={{ color: MUTED, marginTop: 6 }}>
              Orden: del más antiguo al más nuevo. Desliza lateralmente para ver todo el año.
            </Text>
          </View>

          {/* Proyección a futuro */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Proyección a fecha objetivo (según tendencia {latestYear ?? '—'})
            </Text>
            <View style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: MUTED, fontSize: 12, fontWeight: '700', marginLeft: 2 }}>
                    Fecha objetivo
                  </Text>
                  <TouchableOpacity
                    onPress={() => setProjOpen(true)}
                    style={{
                      borderWidth: 1,
                      borderColor: BORDER,
                      backgroundColor: '#fff',
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      paddingVertical: 10,
                    }}
                  >
                    <Text style={{ color: NAVY, fontWeight: '900' }}>{projDisplay || '—'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Text style={{ color: MUTED, fontSize: 12, fontWeight: '700' }}>Marca estimada</Text>
                  <Text style={{ color: RED, fontWeight: '900', fontSize: 18, marginTop: 2 }}>
                    {projMs != null ? mmsscc(projMs) : 'No disponible'}
                  </Text>
                </View>
              </View>
              <Text style={{ color: MUTED, marginTop: 6 }}>
                Estimación lineal basada en el comportamiento de esta prueba durante {latestYear ?? '—'}. Úsalo como
                referencia orientativa.
              </Text>
            </View>
          </View>

          {/* Histórico */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Histórico · {toTitleCase(styleSel)} {distSel} m · Piscina {poolSel} m
            </Text>
            {filteredAll.length ? (
              [...filteredAll]
                .slice()
                .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
                .map((r, idx) => {
                  const isBest = bestOfHistoryMs != null && r.timeMs === bestOfHistoryMs;
                  return (
                    <View
                      key={`${r.date}-${idx}`}
                      style={[styles.row, isBest && { backgroundColor: '#EAF6EF', borderColor: '#B8E2C8' }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: NAVY, fontWeight: isBest ? '900' : '800' }}>
                          {r.timeStr ?? (typeof r.timeMs === 'number' ? mmsscc(r.timeMs) : '—')}
                        </Text>
                        <Text style={{ color: MUTED, marginTop: 2 }}>
                          {r.dateDisplay ?? formatISOasDDMM(r.date)} · {r.origin === 'Race' ? 'Competencia' : 'Entrenamiento'}
                          {r.poolLength ? ` · ${r.poolLength} m` : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        {!!r.eventName && (
                          <Text style={{ color: NAVY, fontWeight: '700' }} numberOfLines={1}>
                            {r.eventName}
                          </Text>
                        )}
                        {isBest && (
                          <View style={styles.badgeBest}>
                            <Text style={styles.badgeBestTxt}>Mejor</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })
            ) : (
              <Text style={{ color: MUTED, marginTop: 6 }}>Sin registros para esta prueba.</Text>
            )}
          </View>

          {/* Mejores por año */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Mejores por año · {toTitleCase(styleSel)} · {distSel} m
            </Text>
            {(() => {
              const map: Record<number, number> = {};
              for (const r of filteredAll) {
                const y = parseYear(r.date);
                if (!y || typeof r.timeMs !== 'number') continue;
                const prev = map[y];
                if (prev == null || r.timeMs < prev) map[y] = r.timeMs;
              }
              const ys = Object.keys(map)
                .map(Number)
                .sort((a, b) => a - b);
              return ys.length ? (
                ys.map((y) => (
                  <View key={y} style={styles.row}>
                    <Text style={{ color: NAVY, fontWeight: '700' }}>{y}</Text>
                    <Text style={{ color: NAVY, fontWeight: '900' }}>{mmsscc(map[y])}</Text>
                  </View>
                ))
              ) : (
                <Text style={{ color: MUTED, marginTop: 6 }}>Sin datos.</Text>
              );
            })()}
          </View>
        </ScrollView>
      )}

      {/* === MODALES SELECT === */}
      {/* Estilo */}
      <Modal transparent visible={openStyle} animationType="fade" onRequestClose={() => setOpenStyle(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpenStyle(false)} />
        <View style={styles.pickerCard}>
          <Text style={styles.modalTitle}>Elegir estilo</Text>
          <FlatList
            data={STYLE_ORDER as unknown as string[]}
            keyExtractor={(x) => x}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  setStyleSel(item as any);
                  setOpenStyle(false);
                }}
                style={styles.pickerItem}
              >
                <Text style={[styles.pickerItemTxt, item === styleSel && styles.pickerItemTxtOn]}>{item}</Text>
              </TouchableOpacity>
            )}
            style={styles.pickerList}
          />
          <TouchableOpacity onPress={() => setOpenStyle(false)} style={styles.modalClose}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Distancia */}
      <Modal transparent visible={openDist} animationType="fade" onRequestClose={() => setOpenDist(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpenDist(false)} />
        <View style={styles.pickerCard}>
          <Text style={styles.modalTitle}>Elegir distancia</Text>
          <FlatList
            data={distsForStyle}
            keyExtractor={(x) => String(x)}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  setDistSel(item);
                  setOpenDist(false);
                }}
                style={styles.pickerItem}
              >
                <Text style={[styles.pickerItemTxt, item === distSel && styles.pickerItemTxtOn]}>{item} m</Text>
              </TouchableOpacity>
            )}
            style={styles.pickerList}
          />
          <TouchableOpacity onPress={() => setOpenDist(false)} style={styles.modalClose}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Modal Proyección: fecha objetivo DD/MM/AAAA */}
      <Modal transparent visible={projOpen} animationType="fade" onRequestClose={() => setProjOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setProjOpen(false)} />
        <View style={styles.projCard}>
          <Text style={styles.modalTitle}>Fecha objetivo</Text>
          <Text style={{ color: MUTED, marginTop: 4 }}>Ingresa la fecha en formato DD/MM/AAAA.</Text>

          <TextInput
            value={projDisplay}
            onChangeText={(txt) => setProjDisplay(maskDateDigitsToDisplay(txt))}
            placeholder="DD/MM/AAAA"
            placeholderTextColor={MUTED}
            style={styles.projInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={Platform.select({
              ios: 'numbers-and-punctuation',
              android: 'numeric',
              default: 'numeric',
            })}
          />

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity onPress={() => setProjOpen(false)} style={[styles.btnPlain, { flex: 1 }]}>
              <Text style={styles.btnPlainText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                const iso = displayDateToISO(projDisplay);
                setProjISO(iso || null);
                setProjOpen(false);
              }}
              style={[styles.modeBtn, { flex: 1 }]}
            >
              <Text style={{ color: '#fff', fontWeight: '900' }}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function LegendDot({ color, label, dash = false }: { color: string; label: string; dash?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 18,
          height: 4,
          backgroundColor: color,
          borderRadius: 2,
          borderWidth: dash ? 0 : 0,
        }}
      />
      <Text style={{ color: MUTED, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  heroCard: {
    backgroundColor: WHITE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  heroName: { color: NAVY, fontSize: 18, fontWeight: '900', flexWrap: 'wrap' },
  heroLine: { color: MUTED, marginTop: 2, flexWrap: 'wrap' },
  strong: { color: NAVY, fontWeight: '800' },

  // FILTROS (fila 3/3)
  filtersRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  select: {
    flex: 1,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 54,
    justifyContent: 'center',
  },
  selectLabel: { color: MUTED, fontSize: 12, fontWeight: '700' },
  selectValue: { color: NAVY, fontWeight: '900', fontSize: 15, marginTop: 2 },

  // Piscina switch
  poolSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 6,
  },
  poolSeg: { flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%' },
  poolSegOn: { backgroundColor: NAVY },
  poolSegTxt: { color: NAVY, fontWeight: '800' },
  poolSegTxtOn: { color: '#fff', fontWeight: '900' },

  kpisRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  kpiCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    minWidth: 0,
  },
  kpiTitle: { color: NAVY, fontSize: 12, fontWeight: '700' },
  kpiValueBig: { fontSize: 18, fontWeight: '900', marginTop: 2 },

  card: {
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    marginTop: 12,
  },
  cardTitle: { color: NAVY, fontWeight: '800', flexWrap: 'wrap' },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    backgroundColor: '#fff',
  },

  badgeBest: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EAF6EF',
    borderWidth: 1,
    borderColor: '#B8E2C8',
  },
  badgeBestTxt: { color: '#137333', fontWeight: '900', fontSize: 11 },

  // Modales / pickers
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  pickerCard: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '22%',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  modalTitle: { color: NAVY, fontWeight: '900', marginBottom: 8 },
  pickerList: { backgroundColor: '#fff', borderWidth: 1, borderColor: BORDER, borderRadius: 10 },
  pickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
  },
  pickerItemTxt: { color: NAVY, fontWeight: '800' },
  pickerItemTxtOn: { color: RED, fontWeight: '900' },
  modalClose: {
    alignSelf: 'center',
    marginTop: 10,
    backgroundColor: RED,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  // Proyección
  projCard: {
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
  projInput: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 10,
    color: NAVY,
    backgroundColor: '#fff',
  },

  // Botones
  btnPlain: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: BORDER,
  },
  btnPlainText: { color: NAVY, fontWeight: '900' },
  modeBtn: {
    backgroundColor: RED,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
});
