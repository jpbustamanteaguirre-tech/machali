// app/athletes/[id]/progress-full.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Victory from 'victory-native';
import { db } from '../../../src/services/firebase';

const NAVY = '#0B1E2F';
const GREEN = '#0E7A3E';
const BG = '#0B1E2F'; // fondo oscuro para fullscreen
const BORDER = '#2B3E50';
const MUTED = '#BFD1E3';

type Result = {
  style: string;
  distance: number;
  timeMs?: number;
  timeStr?: string;
  date?: string;        // ISO YYYY-MM-DD
  dateDisplay?: string; // DD/MM/AAAA
  poolLen?: number;     // largo de piscina (25/50) opcional
};

const toTitleCase = (s?: string) =>
  (s ?? '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');

const keyOf = (style: string, distance: number, poolLen?: number) =>
  `${toTitleCase(style)}|${distance}|${poolLen ?? 'any'}`;
const parseYear = (iso?: string) => (iso?.slice(0, 4) ? Number(iso.slice(0, 4)) : undefined);

function mmsscc(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const cc = Math.floor((total % 1000) / 10);
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}
function formatDateTick(t: any) {
  try {
    const d = t instanceof Date ? t : new Date(t);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  } catch {
    return String(t);
  }
}
function formatISOasDDMM(iso?: string) {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mm, dd] = m;
  return `${dd}/${mm}/${y}`;
}

// ==== Claves de caché (versionadas por pantalla FULL) ====
const K_NAME = (athId: string) => `ath_prog_full_name_v1:${athId}`;
const K_RESULTS = (athId: string) => `ath_prog_full_results_v1:${athId}`;

export default function FullProgress() {
  const { id, styleSel, distSel, poolSel, historic } = useLocalSearchParams<{
    id: string;
    styleSel: string;
    distSel: string;
    poolSel?: string;
    historic?: string; // "1" o "0"
  }>();

  // —— ORIENTACIÓN: bloquear en landscape al entrar y restaurar portrait al salir ——
  const screenOrientationRef = useRef<any>(null);
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          if (Platform.OS !== 'web') {
            const SO = await import('expo-screen-orientation');
            screenOrientationRef.current = SO;
            await SO.lockAsync(SO.OrientationLock.LANDSCAPE);
          }
        } catch (e) {
          console.warn('[progress-full] No se pudo bloquear orientación:', e);
        }
      })();
      return () => {
        (async () => {
          try {
            if (screenOrientationRef.current) {
              await screenOrientationRef.current.lockAsync(
                screenOrientationRef.current.OrientationLock.PORTRAIT_UP
              );
            }
          } catch {}
        })();
      };
    }, [])
  );

  // —— Datos ——
  const [athleteName, setAthleteName] = useState<string>('Nadador');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);

  // Debounce para escrituras al caché
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = (key: string, value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(key, value).catch(() => {});
    }, 250);
  };

  // Hidratar desde caché al montar
  useEffect(() => {
    let cancelled = false;
    const athId = String(id || '');
    if (!athId) return;

    (async () => {
      try {
        const [nameSaved, resultsSaved] = await Promise.all([
          AsyncStorage.getItem(K_NAME(athId)),
          AsyncStorage.getItem(K_RESULTS(athId)),
        ]);
        if (cancelled) return;

        if (nameSaved && nameSaved.trim()) setAthleteName(nameSaved);
        if (resultsSaved) {
          const parsed = JSON.parse(resultsSaved) as Result[];
          setResults(Array.isArray(parsed) ? parsed : []);
          setLoading(false); // mostramos algo al tiro
        }
      } catch {
        // ignoramos errores de lectura
      }
    })();

    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [id]);

  // Cargar online + guardar en caché
  useEffect(() => {
    const athId = String(id || '');
    if (!athId) return;

    // Nombre (one-shot)
    (async () => {
      try {
        const s = await getDoc(doc(db, 'athletes', athId));
        const nm = toTitleCase((s.data() as any)?.name ?? 'Nadador');
        setAthleteName(nm);
        debouncedSave(K_NAME(athId), nm);
      } catch {
        // si falla, permanecemos con lo del caché
      }
    })();

    // Resultados (live)
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
  }, [id]);

  const styleValue = toTitleCase(String(styleSel || 'Libre'));
  const distanceValue = Number(distSel || 50);
  const poolValue: number | undefined =
    poolSel && String(poolSel) !== 'any' ? Number(poolSel) : undefined;
  const isHistoric = String(historic || '0') === '1';

  // Mejor por año (aplicando también piscina si está filtrada)
  const { yearsSorted, bestByYear } = useMemo(() => {
    const map: Record<number, Record<string, number>> = {};
    for (const r of results) {
      if (toTitleCase(r.style) !== styleValue) continue;
      if (Number(r.distance) !== distanceValue) continue;
      if (poolValue != null && Number(r.poolLen ?? 0) !== poolValue) continue;

      const y = parseYear(r.date);
      if (!y || typeof r.timeMs !== 'number') continue;

      const key = keyOf(r.style, r.distance, poolValue ?? r.poolLen);
      map[y] = map[y] || {};
      const prev = map[y][key];
      if (prev == null || r.timeMs < prev) map[y][key] = r.timeMs;
    }
    const ys = Object.keys(map).map(Number).sort((a, b) => a - b);
    return { yearsSorted: ys, bestByYear: map };
  }, [results, styleValue, distanceValue, poolValue]);

  // Serie: histórico (mejores por año) o último año con todas las competencias
  const {
    latestYear,
    series,
    best2024Point,
    statText,
    yDomain,
  } = useMemo(() => {
    const key = keyOf(styleValue, distanceValue, poolValue);

    // Histórico (mejor por año)
    if (isHistoric) {
      const pts: { x: Date; y: number; label: string }[] = [];
      yearsSorted.forEach((y) => {
        const val = bestByYear[y]?.[key];
        if (val != null) {
          const secs = Math.round(val / 10) / 100;
          pts.push({ x: new Date(y, 6, 1), y: secs, label: `${y}\n${mmsscc(val)}` });
        }
      });

      const b2024 = bestByYear[2024]?.[key];
      const b2024Pt =
        b2024 != null
          ? { x: new Date(2024, 6, 1), y: Math.round(b2024 / 10) / 100, label: `Mejor 2024\n${mmsscc(b2024)}` }
          : null;

      let minY = Infinity, maxY = -Infinity;
      [...pts, ...(b2024Pt ? [b2024Pt] : [])].forEach((p) => { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
      if (!isFinite(minY) || !isFinite(maxY)) { minY = 0; maxY = 1; }
      const pad = (maxY - minY) * 0.2 || 0.5;
      const domainY: [number, number] = [minY - pad, maxY + pad];

      let stat = 'Sin datos comparables.';
      if (yearsSorted.length >= 2) {
        const prevY = yearsSorted[yearsSorted.length - 2];
        const currY = yearsSorted[yearsSorted.length - 1];
        const prev = bestByYear[prevY]?.[key];
        const curr = bestByYear[currY]?.[key];
        if (prev != null && curr != null && prev > 0) {
          const pct = ((prev - curr) / prev) * 100;
          stat = `Mejora ${prevY}→${currY}: ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% — mejor anual.`;
        }
      }

      return { latestYear: undefined, series: pts, best2024Point: b2024Pt, statText: stat, yDomain: domainY };
    }

    // Último año con resultados de esta prueba (todas las competencias)
    let lastY = -Infinity;
    for (const r of results) {
      if (toTitleCase(r.style) !== styleValue) continue;
      if (Number(r.distance) !== distanceValue) continue;
      if (poolValue != null && Number(r.poolLen ?? 0) !== poolValue) continue;
      const y = parseYear(r.date);
      if (y && y > lastY) lastY = y;
    }
    const latestY = lastY === -Infinity ? undefined : lastY;

    const rows =
      latestY == null
        ? []
        : results
            .filter((r) => {
              if (parseYear(r.date) !== latestY) return false;
              if (toTitleCase(r.style) !== styleValue) return false;
              if (Number(r.distance) !== distanceValue) return false;
              if (poolValue != null && Number(r.poolLen ?? 0) !== poolValue) return false;
              return typeof r.timeMs === 'number';
            })
            .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));

    const pts = rows.map((r) => {
      const secs = Math.round((r.timeMs as number) / 10) / 100;
      return { x: r.date ? new Date(r.date) : new Date(latestY!, 0, 1), y: secs, label: `${r.dateDisplay ?? formatISOasDDMM(r.date)}\n${mmsscc(r.timeMs as number)}` };
    });

    const map2024 = bestByYear[2024];
    const best2024 = map2024?.[key];
    const b2024Pt =
      best2024 != null
        ? { x: new Date(2024, 6, 1), y: Math.round(best2024 / 10) / 100, label: `Mejor 2024\n${mmsscc(best2024)}` }
        : null;

    let minY = Infinity, maxY = -Infinity;
    [...pts, ...(b2024Pt ? [b2024Pt] : [])].forEach((p) => { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    if (!isFinite(minY) || !isFinite(maxY)) { minY = 0; maxY = 1; }
    const pad = (maxY - minY) * 0.2 || 0.5;
    const domainY: [number, number] = [minY - pad, maxY + pad];

    let stat = 'Sin datos comparables.';
    if (yearsSorted.length >= 2) {
      const prevY = yearsSorted[yearsSorted.length - 2];
      const currY = yearsSorted[yearsSorted.length - 1];
      const prev = bestByYear[prevY]?.[key];
      const curr = bestByYear[currY]?.[key];
      if (prev != null && curr != null && prev > 0) {
        const pct = ((prev - curr) / prev) * 100;
        stat = `Mejora ${prevY}→${currY}: ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% — mejor anual.`;
      }
    }

    return { latestYear: latestY, series: pts, best2024Point: b2024Pt, statText: stat, yDomain: domainY };
  }, [results, bestByYear, yearsSorted, styleValue, distanceValue, poolValue, isHistoric]);

  const width = Math.max(Dimensions.get('window').width, 800);
  const height = Math.max(Dimensions.get('window').height - 40, 320);

  const hasVictory = !!(Victory as any)?.VictoryChart;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Progreso · {athleteName}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: 12 }}>
        <View style={[styles.card, { width }]}>
          {loading ? (
            <Text style={styles.muted}>Cargando…</Text>
          ) : !hasVictory ? (
            <>
              <Text style={styles.muted}>Para ver el gráfico instala/actualiza dependencias:</Text>
              <Text style={[styles.muted, { marginTop: 6 }]}>
                expo install victory-native react-native-svg
              </Text>
            </>
          ) : (series.length || best2024Point) ? (
            <Victory.VictoryChart
              height={height}
              width={width - 24}
              padding={{ left: 56, right: 24, top: 24, bottom: 46 }}
              scale={{ x: 'time' }}
              domain={{ y: yDomain }}
              containerComponent={
                <Victory.VictoryVoronoiContainer
                  labels={({ datum }: any) => (datum?.label ?? '') as string}
                  labelComponent={<Victory.VictoryTooltip constrainToVisibleArea />}
                />
              }
            >
              <Victory.VictoryAxis
                tickFormat={(t: Date | number | string) => formatDateTick(t)}
                style={{
                  axis: { stroke: '#5B7186' },
                  tickLabels: { fill: '#E6EEF7', fontSize: 12, angle: 0, padding: 8 },
                  grid: { stroke: 'transparent' },
                }}
                tickCount={6}
              />
              <Victory.VictoryAxis
                dependentAxis
                tickFormat={(t: number | string) => Number(t).toFixed(2)}
                style={{
                  axis: { stroke: '#5B7186' },
                  tickLabels: { fill: '#E6EEF7', fontSize: 12, padding: 6 },
                  grid: { stroke: '#2A3A49' },
                }}
                tickCount={7}
              />

              {series.length > 0 && (
                <>
                  <Victory.VictoryLine
                    data={series}
                    interpolation="monotoneX"
                    style={{ data: { stroke: '#7FB7FF', strokeWidth: 2 } }}
                  />
                  <Victory.VictoryScatter data={series} size={3.5} style={{ data: { fill: '#FFAF9F' } }} />
                  <Victory.VictoryLine
                    data={series}
                    interpolation="natural"
                    style={{ data: { stroke: '#47E6B1', strokeWidth: 1.5, strokeDasharray: '6,4' } }}
                  />
                </>
              )}

              {best2024Point && (
                <Victory.VictoryScatter data={[best2024Point]} size={5} style={{ data: { fill: GREEN } }} />
              )}
            </Victory.VictoryChart>
          ) : (
            <Text style={styles.muted}>Sin datos para graficar.</Text>
          )}

          <Text style={styles.footer}>
            {toTitleCase(String(styleSel))} · {distanceValue} m
            {poolValue ? ` · P${poolValue}` : ''} — {statText}
            {isHistoric
              ? ' · vista: histórico (mejores por año).'
              : ` · vista: competencias ${latestYear ?? '—'}.`}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BG,
  },
  back: { color: '#E6EEF7', fontSize: 20, fontWeight: '700' },
  title: { flex: 1, textAlign: 'center', color: '#E6EEF7', fontSize: 16, fontWeight: '800' },
  card: {
    backgroundColor: '#122435',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    marginTop: 8,
    marginBottom: 14,
  },
  muted: { color: MUTED },
  footer: { color: '#CFE2F2', marginTop: 8 },
});
