// app/attendance/history.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { getCategory } from '../../src/utils/category';

const BG = '#F7F8FA';
const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BORDER = '#E6E8EC';
const MUTED = '#8A98A8';
const CHIP_BG = '#EDEFF3';

// ===== CONFIG =====
const PREFETCH_MONTHS = 3;
const UI_MONTHS = 18;

// ===== CACHE KEYS (versión) =====
const K_MONTH_CACHE = 'att_hist_monthCache_v1';
const K_ATH_CACHE = 'att_hist_athCache_v1';
const K_ALL_MONTHS = 'att_hist_allMonths_v1';
const K_UI = 'att_hist_ui_v1';

type DayKey = 'Lunes'|'Martes'|'Miércoles'|'Jueves'|'Viernes'|'Sábado'|'Domingo';
type TimeRange = { start: string; end: string };
type Schedule = Record<DayKey, TimeRange[]>;
type Group = { id: string; name: string; schedule?: Schedule; athleteIds?: string[] };

type Athlete = {
  id: string;
  name: string;
  birth?: string;
  seasonYear?: number;
  status?: 'pending'|'active'|'inactive';
};

type AttendanceDoc = {
  athleteId: string;
  sessionDate: string;     // ISO YYYY-MM-DD
  present: boolean;
  justified?: boolean;
  justifiedReason?: string | null;
  createdAt?: any;         // Firestore Timestamp (opcional)
  // opcionalmente pueden venir:
  // groupId?: string;
  // groupName?: string;
};

function toTitleCase(s: string) {
  return (s || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(w => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}
function getAgeFromISO(iso?: string): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [_, yy, mm, dd] = m;
  const birth = new Date(Date.UTC(Number(yy), Number(mm)-1, Number(dd)));
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getUTCFullYear();
  const hadBDay =
    now.getMonth() > (Number(mm)-1) ||
    (now.getMonth() === (Number(mm)-1) && now.getDate() >= Number(dd));
  if (!hadBDay) age -= 1;
  return age;
}
function pctLabel(presents: number, total: number) {
  const pct = total ? Math.round((presents / total) * 100) : 0;
  return `${presents} de ${total} (${pct}%)`;
}
function endOfMonthISO(yy: string, mm: string) {
  const last = new Date(Date.UTC(Number(yy), Number(mm), 0)).getUTCDate();
  return `${yy}-${mm}-${String(last).padStart(2,'0')}`;
}
function getLastNMonths(n: number) {
  const out: Array<{ yy: string; mm: string }> = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const yy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2,'0');
    out.push({ yy, mm });
  }
  return out;
}
function monthLabel(yy: string, mm: string) {
  return toTitleCase(new Date(`${yy}-${mm}-01T00:00:00Z`).toLocaleString('es-CL', { month: 'long', timeZone: 'UTC' })) + ` ${yy}`;
}
function chunk<T>(arr: T[], size = 10) {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}
function getAthleteName(aid: string, athletes: Athlete[]) {
  const a = athletes.find(x => x.id === aid);
  return toTitleCase(a?.name || '—');
}

// === Grupo en el que SE TOMÓ la asistencia ===
function labelGroupOfAttendance(it: AttendanceDoc, groups: Group[]) {
  const anyIt = it as any;
  if (typeof anyIt.groupName === 'string' && anyIt.groupName.trim()) return anyIt.groupName;
  if (typeof anyIt.groupId === 'string' && anyIt.groupId.trim()) {
    const g = groups.find(gr => gr.id === anyIt.groupId);
    if (g?.name) return g.name;
  }
  // Fallback solo si el doc no trae nada:
  const gName = groups.find(g => (g.athleteIds ?? []).includes(it.athleteId))?.name;
  return gName ?? '—';
}
function groupKeyOf(it: any) {
  return (it?.groupId || it?.groupName || 'nogroup');
}

// === Render compacto para el modal por día: Nombre | Grupo (de asistencia) | Estado ===
function renderCompactRows(
  list: AttendanceDoc[],
  status: 'Presente' | 'Ausente' | 'Justificado',
  athletes: Athlete[],
  groups: Group[]
) {
  // dedupe por (athlete + fecha + grupo) → mantiene sesiones por grupo
  const seen = new Set<string>();
  const unique: AttendanceDoc[] = [];

  list.forEach((x) => {
    const gName = labelGroupOfAttendance(x, groups);
    const key = `${x.athleteId}_${x.sessionDate}_${gName}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(x);
    }
  });

  const rows = unique
    .map(doc => ({
      name: getAthleteName(doc.athleteId, athletes),
      group: labelGroupOfAttendance(doc, groups),
      doc,
    }))
    .sort((a, b) => {
      const n = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      if (n !== 0) return n;
      return a.group.localeCompare(b.group, 'es', { sensitivity: 'base' });
    });

  if (!rows.length) return <Text style={{ color: MUTED }}>—</Text>;

  return rows.map((it, idx) => (
    <View key={`${status}_${idx}`} style={styles.row}>
      <Text style={{ color: NAVY, fontWeight: '800', flex: 1 }} numberOfLines={1}>
        {it.name}
      </Text>
      <Text style={{ color: MUTED, marginRight: 8 }} numberOfLines={1}>
        {it.group}
      </Text>

      {status === 'Presente' ? (
        <View style={styles.attOk}><Text style={styles.attOkTxt}>Presente</Text></View>
      ) : status === 'Ausente' ? (
        <View style={styles.attNo}><Text style={styles.attNoTxt}>Ausente</Text></View>
      ) : (
        <View style={[styles.badge, { backgroundColor: '#FFF4E5', borderColor: '#FFD8A8' }]}>
          <Text style={[styles.badgeTxt, { color: '#B85C00' }]}>Justificado</Text>
        </View>
      )}
    </View>
  ));
}

export default function AttendanceHistory() {
  const insets = useSafeAreaInsets();

  // Header
  const [headerH, setHeaderH] = useState(0);
  const onHeaderLayout = (e: LayoutChangeEvent) => setHeaderH(e.nativeEvent.layout.height);

  // Estado base
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  // Modalidad
  const [mode, setMode] = useState<'alumnos'|'fecha'|'grupos'>('fecha');

  // ===== Carga atletas
  useEffect(() => {
    const qy = query(collection(db, 'athletes'), orderBy('name', 'asc'));
    const unsub = onSnapshot(qy, (snap) => {
      const arr: Athlete[] = [];
      snap.forEach(d => {
        const a = { id: d.id, ...(d.data() as any) } as Athlete;
        a.name = toTitleCase(a.name || '');
        arr.push(a);
      });
      setAthletes(arr);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  // ===== Carga grupos
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'groups')), (snap) => {
      const arr: Group[] = [];
      snap.forEach(d => arr.push({ id: d.id, ...(d.data() as any) }));
      arr.sort((a,b)=> (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity:'base' }));
      setGroups(arr);
    });
    return unsub;
  }, []);

  // ===== Helpers
  function goBackToAttendance() {
    if (router.canGoBack()) router.back();
    else router.replace('/attendance');
  }
  function countPresentAbsent(docs: AttendanceDoc[]) {
    let present = 0, absent = 0;
    docs.forEach(x => {
      if (x.justified) return;
      if (x.present) present += 1;
      else absent += 1;
    });
    return { present, total: present + absent };
  }

  /* ===================== CARGA LAZY / CACHES ===================== */
  const [monthCache, setMonthCache] = useState<Record<string, AttendanceDoc[]>>({});
  const [monthLoading, setMonthLoading] = useState<Record<string, boolean>>({});

  // ======= Restaurar cachés/UI desde AsyncStorage al montar =======
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const [mc, ac, am, ui] = await Promise.all([
          AsyncStorage.getItem(K_MONTH_CACHE),
          AsyncStorage.getItem(K_ATH_CACHE),
          AsyncStorage.getItem(K_ALL_MONTHS),
          AsyncStorage.getItem(K_UI),
        ]);
        if (mc) setMonthCache(JSON.parse(mc));
        if (ac) setAthCache(JSON.parse(ac));
        if (am) setAllMonths(JSON.parse(am));
        if (ui) {
          const parsed = JSON.parse(ui) || {};
          if (parsed.viewType) setViewType(parsed.viewType);
          if (parsed.monthSelYY) setMonthSelYY(parsed.monthSelYY);
          if (parsed.monthSelMM) setMonthSelMM(parsed.monthSelMM);
          if (parsed.openMonthsFecha) setOpenMonthsFecha(parsed.openMonthsFecha);
          if (parsed.openGroupsGr) setOpenGroupsGr(parsed.openGroupsGr);
          if (parsed.openMonthsGr) setOpenMonthsGr(parsed.openMonthsGr);
          if (parsed.openAthMonths) setOpenAthMonths(parsed.openAthMonths);
        }
      } catch {
        // ignora fallos de parseo
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // ======= Guardado con debounce =======
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function debouncedSave(key: string, val: any) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(key, JSON.stringify(val)).catch(() => {});
    }, 300);
  }

  useEffect(() => {
    if (!hydrated) return;
    debouncedSave(K_MONTH_CACHE, monthCache);
  }, [monthCache, hydrated]);

  /* ===================== Lecturas ===================== */
  // === LECTURA DESDE 'attendance' por grupo/mes
  async function fetchMonthForGroup(groupId: string, yy: string, mm: string) {
    const key = `g:${groupId}_${yy}-${mm}`;
    if (monthCache[key] || monthLoading[key]) return;

    const grp = groups.find(g => g.id === groupId);
    const ids = grp?.athleteIds ?? [];
    setMonthLoading(prev => ({ ...prev, [key]: true }));
    try {
      if (ids.length === 0) {
        setMonthCache(prev => ({ ...prev, [key]: [] }));
        return;
      }
      const start = `${yy}-${mm}-01`;
      const end = endOfMonthISO(yy, mm);
      const batches = chunk(ids, 10);
      const results: AttendanceDoc[] = [];

      for (const ids10 of batches) {
        const qy = query(
          collection(db, 'attendance'),
          where('athleteId', 'in', ids10),
          where('sessionDate', '>=', start),
          where('sessionDate', '<=', end),
          orderBy('sessionDate', 'asc')
        );
        const snap = await getDocs(qy);
        snap.forEach(d => {
          const it = d.data() as any;
          if (!it.athleteId || !it.sessionDate) return;
          results.push({
            athleteId: it.athleteId,
            sessionDate: it.sessionDate,
            present: !!it.present,
            justified: !!it.justified,
            justifiedReason: it.justifiedReason ?? null,
            createdAt: it.createdAt ?? null,
            ...(it.groupId ? { groupId: it.groupId } : {}),
            ...(it.groupName ? { groupName: it.groupName } : {}),
          });
        });
      }
      setMonthCache(prev => ({ ...prev, [key]: results }));
    } catch {
      setMonthCache(prev => ({ ...prev, [key]: [] }));
    } finally {
      setMonthLoading(prev => ({ ...prev, [key]: false }));
    }
  }
  async function ensureMonthLoaded(groupId: string, yy: string, mm: string) {
    const key = `g:${groupId}_${yy}-${mm}`;
    if (monthCache[key] || monthLoading[key]) return;
    await fetchMonthForGroup(groupId, yy, mm);
  }

  // === Calcula dinámicamente todos los meses con registros en attendance ===
  const [allMonths, setAllMonths] = useState<{ yy: string; mm: string }[]>([]);

  useEffect(() => {
    // si ya se hidrató y tenemos meses almacenados, no forzar lectura total
    if (hydrated && allMonths.length > 0) return;

    const calcMonths = async () => {
      try {
        const snap = await getDocs(collection(db, 'attendance'));
        const seen = new Set<string>();
        snap.forEach(d => {
          const data = d.data() as any;
          if (!data.sessionDate) return;
          const y = data.sessionDate.slice(0, 4);
          const m = data.sessionDate.slice(5, 7);
          seen.add(`${y}-${m}`);
        });

        // orden descendente (más reciente → más antiguo)
        const list = Array.from(seen)
          .map(x => ({ yy: x.slice(0, 4), mm: x.slice(5, 7) }))
          .sort((a, b) => (a.yy === b.yy ? Number(b.mm) - Number(a.mm) : Number(b.yy) - Number(a.yy)));
        setAllMonths(list);
      } catch {
        // ignora
      }
    };

    calcMonths();
  }, [hydrated]); // recalcula una vez tras hidratar

  useEffect(() => {
    if (!hydrated) return;
    debouncedSave(K_ALL_MONTHS, allMonths);
  }, [allMonths, hydrated]);

  // Prefetch de todos los meses con registros (respetando grupos)
  useEffect(() => {
    if (!groups.length || !allMonths.length) return;
    groups.forEach((g, gi) => {
      allMonths.forEach(({ yy, mm }, mi) => {
        setTimeout(() => { fetchMonthForGroup(g.id, yy, mm); }, (gi * allMonths.length + mi) * 40);
      });
    });
  }, [groups, allMonths]);

  // ===== Cache por alumno (para detalle completo)
  const [athCache, setAthCache] = useState<Record<string, AttendanceDoc[]>>({});
  const [athLoading, setAthLoading] = useState<Record<string, boolean>>({});

  // persistir athCache
  useEffect(() => {
    if (!hydrated) return;
    debouncedSave(K_ATH_CACHE, athCache);
  }, [athCache, hydrated]);

  // === LECTURA TODO EL HISTORIAL DEL ALUMNO ===
  async function fetchAthleteAll(athleteId: string) {
    if (athCache[athleteId] || athLoading[athleteId]) return;
    setAthLoading(prev => ({ ...prev, [athleteId]: true }));
    try {
      const qy = query(
        collection(db,'attendance'),
        where('athleteId','==', athleteId),
        orderBy('sessionDate','asc') // subimos asc y luego ordenamos como necesitemos
      );
      const snap = await getDocs(qy);
      const arr: AttendanceDoc[] = [];
      snap.forEach(d => {
        const it = d.data() as any;
        if (!it.athleteId || !it.sessionDate) return;
        arr.push({
          athleteId: it.athleteId,
          sessionDate: it.sessionDate,
          present: !!it.present,
          justified: !!it.justified,
          justifiedReason: it.justifiedReason ?? null,
          createdAt: it.createdAt ?? null,
          ...(it.groupId ? { groupId: it.groupId } : {}),
          ...(it.groupName ? { groupName: it.groupName } : {}),
        });
      });
      setAthCache(prev => ({ ...prev, [athleteId]: arr }));
    } finally {
      setAthLoading(prev => ({ ...prev, [athleteId]: false }));
    }
  }

  /* ===================== DETALLES POR DÍA (Modal) ===================== */
  const [dayOpen, setDayOpen] = useState(false);
  const [dayTitle, setDayTitle] = useState<string>('');
  const [dayPresent, setDayPresent] = useState<AttendanceDoc[]>([]);
  const [dayAbsent, setDayAbsent] = useState<AttendanceDoc[]>([]);
  const [dayJust, setDayJust] = useState<AttendanceDoc[]>([]);

  // Abrir modal de un día (manteniendo entradas por grupo)
  const openDayDetail = (dateISO: string, rawList: AttendanceDoc[]) => {
    const seen = new Set<string>();
    const list = rawList.filter(x => {
      const key = `${x.athleteId}_${x.sessionDate}_${groupKeyOf(x as any)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const present = list.filter(x => x.present && !x.justified);
    const absent  = list.filter(x => !x.present && !x.justified);
    const just    = list.filter(x => x.justified);
    setDayPresent(present);
    setDayAbsent(absent);
    setDayJust(just);

    const label = new Date(`${dateISO}T00:00:00Z`).toLocaleDateString('es-CL',{
      weekday:'long', day:'2-digit', month:'long', year:'numeric', timeZone:'UTC'
    });
    setDayTitle(toTitleCase(label));
    setDayOpen(true);
  };

  /* ===================== SWITCH GLOBAL (visual) ===================== */
  const [viewType, setViewType] = useState<'Mensual'|'Anual'>('Mensual');

  // (Se mantiene el filtro de mes para el % del listado de alumnos tal como lo tenías)
  const now = new Date();
  const yNow = String(now.getFullYear());
  const mNow = String(now.getMonth()+1).padStart(2,'0');
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [monthSelYY, setMonthSelYY] = useState<string>(yNow);
  const [monthSelMM, setMonthSelMM] = useState<string>(mNow);
  const monthOptions = useMemo(() => allMonths.map(m => `${m.yy}-${m.mm}`), [allMonths]);

  // Persistir preferencias de UI (debounce)
  const [openMonthsFecha, setOpenMonthsFecha] = useState<Record<string, boolean>>({});
  const [openGroupsGr, setOpenGroupsGr] = useState<Record<string, boolean>>({});
  const [openMonthsGr, setOpenMonthsGr] = useState<Record<string, boolean>>({});
  const [openAthMonths, setOpenAthMonths] = useState<Record<string, boolean>>({}); // key: `${yy}-${mm}`

  useEffect(() => {
    if (!hydrated) return;
    debouncedSave(K_UI, {
      viewType, monthSelYY, monthSelMM,
      openMonthsFecha, openGroupsGr, openMonthsGr, openAthMonths,
    });
  }, [viewType, monthSelYY, monthSelMM, openMonthsFecha, openGroupsGr, openMonthsGr, openAthMonths, hydrated]);

  /* ===================== “ALUMNOS” ===================== */
  const statsByAthlete = useMemo(() => {
    const present: Record<string, number> = {};
    const total: Record<string, number> = {};

    function addDocs(docs: AttendanceDoc[]) {
      docs.forEach(x => {
        if (x.justified) return;
        total[x.athleteId] = (total[x.athleteId] ?? 0) + 1;
        if (x.present) present[x.athleteId] = (present[x.athleteId] ?? 0) + 1;
      });
    }

    if (viewType === 'Mensual') {
      groups.forEach(g => {
        const k = `g:${g.id}_${monthSelYY}-${monthSelMM}`;
        const docs = monthCache[k] || [];
        addDocs(docs);
      });
    } else {
      for (let mm = 1; mm <= 12; mm++) {
        const mmStr = String(mm).padStart(2,'0');
        groups.forEach(g => {
          const k = `g:${g.id}_${monthSelYY}-${mmStr}`;
          const docs = monthCache[k] || [];
          addDocs(docs);
        });
      }
    }

    const out: Record<string, string> = {};
    athletes.forEach(a => {
      const p = present[a.id] ?? 0;
      const t = total[a.id] ?? 0;
      out[a.id] = pctLabel(p, t);
    });
    return out;
  }, [viewType, groups, monthCache, athletes, monthSelYY, monthSelMM]);

  /* ===================== “FECHA”: Año ↓ → Mes ↓ → Día ↓ ===================== */
  const groupFilter = 'Todos';

  const byYMD = useMemo(() => {
    const map: Record<string, Record<string, Record<string, AttendanceDoc[]>>> = {};
    const selectedGroupId = groupFilter === 'Todos' ? null : groups.find(g => g.name === groupFilter)?.id ?? null;

    Object.keys(monthCache).forEach(k => {
      const [, rest] = k.split(':');
      const [pairId, ym] = rest.split('_');
      const [yy, mm] = ym.split('-');
      if (selectedGroupId && pairId !== selectedGroupId) return;

      const docs = monthCache[k] || [];
      docs.forEach(x => {
        const dd = x.sessionDate.slice(8,10);
        (map[yy] ??= {});
        (map[yy][mm] ??= {});
        (map[yy][mm][dd] ??= []).push(x);
      });
    });

    // dedupe por (athleteId + fecha + grupo) para conservar sesiones por grupo
    Object.keys(map).forEach(yy => {
      Object.keys(map[yy]).forEach(mm => {
        Object.keys(map[yy][mm]).forEach(dd => {
          const arr = map[yy][mm][dd];
          const seen = new Set<string>();
          map[yy][mm][dd] = arr.filter(x => {
            const key = `${x.athleteId}_${x.sessionDate}_${groupKeyOf(x as any)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        });
      });
    });

    return map;
  }, [monthCache, groupFilter, groups]);

  const toggleMonthFecha = async (yy: string, mm: string) => {
    const k = `f:${yy}-${mm}`;
    const opening = !openMonthsFecha[k];
    setOpenMonthsFecha(prev => ({ ...prev, [k]: !prev[k] }));

    if (opening) {
      await Promise.all(groups.map(g => ensureMonthLoaded(g.id, yy, mm)));
    }
  };

  const isMonthOpenFecha = (yy: string, mm: string) => !!openMonthsFecha[`f:${yy}-${mm}`];

  /* ===================== “GRUPOS”: Mes ↓ → Día ↓ ===================== */
  const groupStats = useMemo(() => {
    const out: Record<string, { p: number; t: number }> = {};
    Object.entries(monthCache).forEach(([k, docs]) => {
      const m = k.match(/^g:([^_]+)_\d{4}-\d{2}$/);
      if (!m) return;
      const gid = m[1];
      let p = out[gid]?.p ?? 0;
      let t = out[gid]?.t ?? 0;
      docs.forEach(x => {
        if (!x.justified) {
          t += 1;
          if (x.present) p += 1;
        }
      });
      out[gid] = { p, t };
    });
    return out;
  }, [monthCache]);

  function toggleGroupGr(id: string) {
    setOpenGroupsGr(prev => ({ ...prev, [id]: !prev[id] }));
  }
  async function toggleMonthGr(groupId: string, yy: string, mm: string) {
    const k = `g:${groupId}_${yy}-${mm}:open`;
    const opening = !openMonthsGr[k];
    setOpenMonthsGr(prev => ({ ...prev, [k]: !prev[k] }));
    if (opening) {
      await ensureMonthLoaded(groupId, yy, mm);
    }
  }
  function monthKey(groupId: string, yy: string, mm: string) {
    return `g:${groupId}_${yy}-${mm}`;
  }
  function daysFromCache(groupId: string, yy: string, mm: string) {
    const list = monthCache[monthKey(groupId, yy, mm)] || [];
    const byDay: Record<string, AttendanceDoc[]> = {};
    list.forEach(x => {
      const dd = x.sessionDate.slice(8,10);
      (byDay[dd] ??= []).push(x);
    });
    // días descendente (más reciente primero)
    const ordered = Object.keys(byDay).sort((a,b)=> Number(b)-Number(a));
    return { byDay, ordered };
  }

  /* ===================== MODAL DETALLE POR ALUMNO (historial completo) ===================== */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailAthlete, setDetailAthlete] = useState<Athlete | null>(null);

  const openAthleteDetail = async (ath: Athlete) => {
    await fetchAthleteAll(ath.id);
    setDetailAthlete(ath);
    setOpenAthMonths({});
    setDetailOpen(true);
  };

  // Estructura Año ↓ → Mes ↓ → Día ↓ para un atleta
  function buildAthleteYMD(athId: string) {
    const all = (athCache[athId] || []).slice();
    // ordenamos por fecha desc para asegurar recientes primero
    all.sort((a,b) => (a.sessionDate < b.sessionDate ? 1 : (a.sessionDate > b.sessionDate ? -1 : 0)));

    const map: Record<string, Record<string, Record<string, AttendanceDoc[]>>> = {};
    all.forEach(x => {
      const yy = x.sessionDate.slice(0,4);
      const mm = x.sessionDate.slice(5,7);
      const dd = x.sessionDate.slice(8,10);
      (map[yy] ??= {});
      (map[yy][mm] ??= {});
      (map[yy][mm][dd] ??= []).push(x);
    });
    return map;
  }

  function monthPct(docs: AttendanceDoc[]) {
    let p = 0, t = 0;
    docs.forEach(x => {
      if (x.justified) return;
      t += 1;
      if (x.present) p += 1;
    });
    return pctLabel(p, t);
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
        {/* Header */}
        <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={goBackToAttendance} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
              <Text style={styles.backTxt}>←</Text>
            </TouchableOpacity>

            <Text style={styles.headerTitle}>Historial</Text>

            <View style={styles.rightWrap}>
              <Text style={styles.menuDotsHidden}>⋮</Text>
              <TouchableOpacity onPress={() => setViewType(v => (v === 'Mensual' ? 'Anual' : 'Mensual'))} activeOpacity={0.9}>
                <View style={[styles.switch, ...(viewType === 'Anual' ? [styles.switchOn] : [])]}>
                  <View style={[styles.knob, ...(viewType === 'Anual' ? [styles.knobOn] : [])]} />
                </View>
              </TouchableOpacity>
              <Text style={styles.menuDotsHidden}>⋮</Text>
            </View>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
        </SafeAreaView>

        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>

        <View
          pointerEvents="none"
          style={{ position:'absolute', left:0, right:0, bottom:0, height: insets.bottom, backgroundColor: NAVY }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
      {/* Header azul fijo */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }} onLayout={onHeaderLayout}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={goBackToAttendance} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Text style={styles.backTxt}>←</Text>
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Historial</Text>

          <View style={styles.rightWrap}>
            <Text style={styles.menuDotsHidden}>⋮</Text>
            <TouchableOpacity onPress={() => setViewType(v => (v === 'Mensual' ? 'Anual' : 'Mensual'))} activeOpacity={0.9}>
              <View style={[styles.switch, ...(viewType === 'Anual' ? [styles.switchOn] : [])]}>
                <View style={[styles.knob, ...(viewType === 'Anual' ? [styles.knobOn] : [])]} />
              </View>
            </TouchableOpacity>
            <Text style={styles.menuDotsHidden}>⋮</Text>
          </View>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {/* Barra de botones de modalidad */}
      <View style={styles.modeBar}>
        <TouchableOpacity onPress={() => setMode('alumnos')} style={[styles.tabBtn, mode==='alumnos' && styles.tabBtnOn]}>
          <Text style={[styles.tabTxt, mode==='alumnos' && styles.tabTxtOn]}>Listado de alumnos</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('fecha')} style={[styles.tabBtn, mode==='fecha' && styles.tabBtnOn]}>
          <Text style={[styles.tabTxt, mode==='fecha' && styles.tabTxtOn]}>Fecha</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('grupos')} style={[styles.tabBtn, mode==='grupos' && styles.tabBtnOn]}>
          <Text style={[styles.tabTxt, mode==='grupos' && styles.tabTxtOn]}>Grupos</Text>
        </TouchableOpacity>
      </View>

      {/* Contenido DESPLAZABLE */}
      <View style={{ flex: 1 }}>
        {mode === 'alumnos' ? (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
              {athletes.length === 0 ? (
                <Text style={{ color: NAVY }}>No hay atletas.</Text>
              ) : athletes
                .filter(a => a.status !== 'inactive')
                .map(item => {
                  const age = getAgeFromISO(item.birth);
                  const cat = getCategory(item.birth, item.seasonYear) || '—';
                  const pct = statsByAthlete[item.id] || pctLabel(0,0);
                  return (
                    <TouchableOpacity key={item.id} onPress={() => openAthleteDetail(item)} style={styles.row} activeOpacity={0.85}>
                      <View style={{ flex:1 }}>
                        <Text style={{ color: NAVY, fontWeight:'800' }}>{toTitleCase(item.name)}</Text>
                        <Text style={{ color: MUTED, marginTop: 2 }}>{age != null ? `${age} años` : '—'} · {cat}</Text>
                      </View>
                      <Text style={{ color: NAVY, fontWeight:'800' }}>{pct}</Text>
                    </TouchableOpacity>
                  );
                })}
            </View>
          </ScrollView>
        ) : mode === 'fecha' ? (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>

            {/* Año ↓ → Mes ↓ → Día ↓ */}
            {Object.keys(byYMD).length === 0 ? (
              <View style={{ padding: 16 }}>
                <Text style={{ color: NAVY }}>Sin asistencia registrada en los meses cargados.</Text>
              </View>
            ) : Object.keys(byYMD).sort((a,b)=> Number(b)-Number(a)).map((yy) => {
              const months = Object.keys(byYMD[yy] || {}).sort((a,b)=> Number(b)-Number(a)); // meses ↓
              return (
                <View key={yy} style={styles.card}>
                  <View style={styles.accordionHdr}>
                    <Text style={styles.accordionTitle}>{yy}</Text>
                  </View>

                  <View style={{ marginTop: 8 }}>
                    {months.map((mm) => {
                      const dayKeys = Object.keys(byYMD[yy][mm] || {}).sort((a,b)=> Number(b)-Number(a)); // días ↓
                      const monthAll = dayKeys.flatMap(d => byYMD[yy][mm][d] || []);
                      const { present: mP, total: mT } = countPresentAbsent(monthAll);
                      const open = isMonthOpenFecha(yy, mm);

                      return (
                        <View key={`${yy}-${mm}`} style={styles.subCard}>
                          <TouchableOpacity onPress={() => toggleMonthFecha(yy, mm)} style={styles.dayRowBtn} activeOpacity={0.85}>
                            <Text style={styles.dayTitle}>
                              {monthLabel(yy, mm)} — {pctLabel(mP, mT)}
                            </Text>
                            <Text style={styles.caret}>{open ? '▴' : '▾'}</Text>
                          </TouchableOpacity>

                          {open && (
                            <View style={{ marginTop: 8 }}>
                              {dayKeys.map((dd) => {
                                const list = (byYMD[yy][mm][dd] || []).slice();
                                const iso = `${yy}-${mm}-${dd}`;
                                const dayName = new Date(`${iso}T00:00:00Z`).toLocaleString('es-CL',{ weekday:'long', timeZone:'UTC' });
                                const { present: pCnt, total: tCnt } = countPresentAbsent(list);

                                return (
                                  <TouchableOpacity
                                    key={`${yy}-${mm}-${dd}`}
                                    onPress={() => openDayDetail(iso, list)}
                                    style={styles.dayRowBtn}
                                    activeOpacity={0.85}
                                  >
                                    <Text style={styles.dayTitle}>
                                      {toTitleCase(dayName)} {Number(dd)} — {pctLabel(pCnt, tCnt)}
                                    </Text>
                                    <Text style={styles.caret}>›</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        ) : (
          // ===== GRUPOS
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            {groups.length === 0 ? (
              <View style={{ padding: 16 }}>
                <Text style={{ color: NAVY }}>No hay grupos configurados.</Text>
              </View>
            ) : groups.map(g => {
              const isOpen = !!openGroupsGr[g.id];
              const gs = groupStats[g.id];
              const pct = gs ? pctLabel(gs.p, gs.t) : '—';

              return (
                <View key={`gr_${g.id}`} style={styles.card}>
                  <TouchableOpacity
                    onPress={() => toggleGroupGr(g.id)}
                    style={styles.accordionHdr}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.accordionTitle}>
                      {g.name} {gs ? `— ${pct}` : ''}
                    </Text>
                    <Text style={styles.caret}>{isOpen ? '▴' : '▾'}</Text>
                  </TouchableOpacity>

                  {isOpen && (
                    <View style={{ marginTop: 8 }}>
                      {allMonths.map(({ yy, mm }) => {
                        const kOpen = `g:${g.id}_${yy}-${mm}:open`;
                        const open = !!openMonthsGr[kOpen];
                        const cacheKey = monthKey(g.id, yy, mm);
                        const { byDay, ordered } = daysFromCache(g.id, yy, mm);
                        const allMonth = (monthCache[cacheKey] || []);
                        if (!allMonth.length) return null; // solo meses con registro
                        const { present: mP, total: mT } = countPresentAbsent(allMonth);

                        return (
                          <View key={kOpen} style={styles.subCard}>
                            <TouchableOpacity onPress={() => toggleMonthGr(g.id, yy, mm)} style={styles.dayRowBtn} activeOpacity={0.85}>
                              <Text style={styles.dayTitle}>
                                {monthLabel(yy, mm)} — {pctLabel(mP, mT)}
                              </Text>
                              <Text style={styles.caret}>{open ? '▴' : '▾'}</Text>
                            </TouchableOpacity>

                            {open && (
                              <View style={{ marginTop: 6 }}>
                                {ordered.length === 0 ? (
                                  <Text style={{ color: MUTED }}>Sin registros.</Text>
                                ) : ordered.map(dd => {
                                  const iso = `${yy}-${mm}-${dd}`;
                                  const list = byDay[dd] || [];
                                  const { present: dP, total: dT } = countPresentAbsent(list);
                                  const dayName = new Date(`${iso}T00:00:00Z`).toLocaleString('es-CL',{ weekday:'long', timeZone:'UTC' });

                                  return (
                                    <TouchableOpacity
                                      key={`${iso}`}
                                      onPress={() => openDayDetail(iso, list)}
                                      style={styles.dayRowBtn}
                                      activeOpacity={0.85}
                                    >
                                      <Text style={styles.dayTitle}>
                                        {toTitleCase(dayName)} {Number(dd)} — {pctLabel(dP, dT)}
                                      </Text>
                                      <Text style={styles.caret}>›</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* ===== Dropdown de MES (para % del listado de alumnos) ===== */}
      <Modal transparent visible={monthPickerOpen} animationType="fade" onRequestClose={() => setMonthPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMonthPickerOpen(false)} />
        <View style={styles.dropdownCard}>
          {monthOptions.map(ym => {
            const [yy, mm] = ym.split('-');
            const lbl = monthLabel(yy, mm);
            const active = (yy === monthSelYY && mm === monthSelMM);
            return (
              <TouchableOpacity
                key={ym}
                onPress={() => { setMonthSelYY(yy); setMonthSelMM(mm); setMonthPickerOpen(false); }}
                style={[st.selectItem, active && st.selectItemActive]}
              >
                <Text style={[st.selectItemText, active && st.selectItemTextActive]}>{lbl}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>

      {/* ===== Modal: Detalle por día ===== */}
      <Modal transparent visible={dayOpen} animationType="fade" onRequestClose={() => setDayOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDayOpen(false)} />
        <View style={styles.modalCardLarge}>
          <Text style={{ color: NAVY, fontWeight:'800', fontSize:16, marginBottom: 8 }}>{dayTitle}</Text>

          {(() => {
            const merged = [...dayPresent, ...dayAbsent, ...dayJust];
            let p = 0, t = 0;
            merged.forEach(x => { if (!x.justified) { t += 1; if (x.present) p += 1; }});
            return (
              <Text style={{ color: NAVY, marginBottom: 10 }}>
                Resumen: <Text style={{ fontWeight:'800' }}>{`${p} de ${t} (${t ? Math.round((p/t)*100) : 0}%)`}</Text>
              </Text>
            );
          })()}

          <ScrollView style={{ maxHeight: 420 }}>
            {/* Presentes */}
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.groupHdr}>Presentes ({dayPresent.length})</Text>
              {renderCompactRows(dayPresent, 'Presente', athletes, groups)}
            </View>

            {/* Ausentes */}
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.groupHdr}>Ausentes ({dayAbsent.length})</Text>
              {renderCompactRows(dayAbsent, 'Ausente', athletes, groups)}
            </View>

            {/* Justificados */}
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.groupHdr}>Justificados ({dayJust.length})</Text>
              {renderCompactRows(dayJust, 'Justificado', athletes, groups)}
            </View>
          </ScrollView>

          <TouchableOpacity onPress={() => setDayOpen(false)} style={{ marginTop: 8 }}>
            <Text style={styles.menuCancel}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ===== Modal: Detalle por ALUMNO (historial completo con acordeón) ===== */}
      <Modal transparent visible={detailOpen} animationType="fade" onRequestClose={() => setDetailOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDetailOpen(false)} />
        <View style={styles.modalCardLarge}>
          <Text style={{ color: NAVY, fontWeight:'800', fontSize:16, marginBottom: 8 }}>
            {toTitleCase(detailAthlete?.name || 'Nadador')}
          </Text>

          {!detailAthlete || athLoading[detailAthlete.id] ? (
            <ActivityIndicator />
          ) : (
            <ScrollView style={{ maxHeight: 440 }}>
              {(() => {
                const map = buildAthleteYMD(detailAthlete.id);
                const years = Object.keys(map).sort((a,b)=> Number(b)-Number(a)); // años ↓
                if (!years.length) return <Text style={{ color: MUTED }}>Sin registros.</Text>;

                return years.map(yy => {
                  const months = Object.keys(map[yy] || {}).sort((a,b)=> Number(b)-Number(a)); // meses ↓
                  return (
                    <View key={`ath_y_${yy}`} style={styles.card}>
                      <Text style={styles.accordionTitle}>{yy}</Text>
                      <View style={{ marginTop: 8 }}>
                        {months.map(mm => {
                          const days = Object.keys(map[yy][mm] || {}).sort((a,b)=> Number(b)-Number(a)); // días ↓
                          const monthDocs = days.flatMap(d => map[yy][mm][d] || []);
                          const pct = monthPct(monthDocs);
                          const k = `${yy}-${mm}`;
                          const open = !!openAthMonths[k];

                          return (
                            <View key={`ath_m_${k}`} style={styles.subCard}>
                              <TouchableOpacity
                                onPress={() => setOpenAthMonths(prev => ({ ...prev, [k]: !prev[k] }))}
                                style={styles.dayRowBtn}
                                activeOpacity={0.85}
                              >
                                <Text style={styles.dayTitle}>{monthLabel(yy, mm)} — {pct}</Text>
                                <Text style={styles.caret}>{open ? '▴' : '▾'}</Text>
                              </TouchableOpacity>

                              {open && (
                                <View style={{ marginTop: 6 }}>
                                  {days.map(dd => {
                                    const iso = `${yy}-${mm}-${dd}`;
                                    const list = (map[yy][mm][dd] || []).slice(); // puede haber varias (por grupo)
                                    // Para cada registro del día, mostrar estado + grupo donde se tomó
                                    return (
                                      <View key={`ath_d_${iso}`} style={{ marginBottom: 4 }}>
                                        {list.map((rec, idx) => {
                                          const grp = labelGroupOfAttendance(rec, groups);
                                          return (
                                            <View key={`ath_row_${iso}_${idx}`} style={styles.row}>
                                              <Text style={{ color: NAVY, fontWeight:'700', flex:1 }}>
                                                {new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-CL',{ weekday:'short', day:'2-digit', month:'short', timeZone:'UTC' })}
                                              </Text>
                                              <Text style={{ color: MUTED, marginRight: 8 }} numberOfLines={1}>{grp}</Text>
                                              {rec.justified ? (
                                                <View style={[styles.badge, { backgroundColor:'#FFF4E5', borderColor:'#FFD8A8' }]}>
                                                  <Text style={[styles.badgeTxt, { color:'#B85C00' }]}>Justificado</Text>
                                                </View>
                                              ) : rec.present ? (
                                                <View style={styles.attOk}><Text style={styles.attOkTxt}>Presente</Text></View>
                                              ) : (
                                                <View style={styles.attNo}><Text style={styles.attNoTxt}>Ausente</Text></View>
                                              )}
                                            </View>
                                          );
                                        })}
                                      </View>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                });
              })()}
            </ScrollView>
          )}

          <TouchableOpacity onPress={() => setDetailOpen(false)} style={{ marginTop: 10 }}>
            <Text style={styles.menuCancel}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Overlay inferior EXACTO al inset del sistema */}
      <View
        pointerEvents="none"
        style={{ position:'absolute', left:0, right:0, bottom:0, height: insets.bottom, backgroundColor: NAVY }}
      />
    </SafeAreaView>
  );
}

/* ===== Estilos ===== */
const styles = StyleSheet.create({
  headerRow: {
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection:'row',
    alignItems:'center',
    justifyContent:'space-between',
  },
  backTxt: { color:'#fff', fontSize:18, includeFontPadding: false as any },
  headerTitle: { color:'#fff', fontSize:18, fontWeight:'700', includeFontPadding: false as any },

  rightWrap: { flexDirection:'row', alignItems:'center', gap: 10 },
  menuDotsHidden: { color:'#fff', fontSize:20, fontWeight:'800', opacity: 0, includeFontPadding: false as any },

  modeBar: {
    backgroundColor: BG,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection:'row',
    gap: 8,
  },

  card: {
    backgroundColor:'#fff',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
  },

  tabBtn: {
    flex:1,
    borderWidth:1, borderColor:BORDER,
    borderRadius:12, paddingVertical:10, alignItems:'center',
    backgroundColor:'#fff',
  },
  tabBtnOn: { backgroundColor:'#EDEFF3', borderColor:'#D5DAE1' },
  tabTxt: { color: NAVY, fontWeight:'700' },
  tabTxtOn: { color: NAVY, fontWeight:'800' },

  sec: { color: NAVY, fontWeight:'800', marginTop: 12, marginBottom: 6 },

  accordionHdr: {
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
    paddingVertical: 8,
  },
  accordionTitle: { color: NAVY, fontWeight:'800' },
  subCard: {
    backgroundColor:'#FAFBFD',
    borderWidth:1, borderColor:BORDER, borderRadius:10,
    padding:10, marginTop:8,
  },
  subTitle: { color: NAVY, fontWeight:'800' },
  caret: { color: MUTED, fontWeight:'800' },

  dayRowBtn: {
    flexDirection:'row', alignItems:'center', paddingVertical: 8,
  },
  dayTitle: { color: NAVY, fontWeight:'800', flex:1 },
  pillsInline: { flexDirection:'row', gap: 6, marginRight: 6 },
  countPill: { borderWidth:1, borderColor:BORDER, borderRadius:12, paddingHorizontal:8, paddingVertical:4, backgroundColor: CHIP_BG },
  countTxt: { color: NAVY, fontWeight:'800' },

  groupHdr: { color: NAVY, fontWeight:'800', marginBottom: 4 },

  row: {
    flexDirection:'row',
    alignItems:'center',
    backgroundColor:'#fff',
    borderWidth:1, borderColor:BORDER, borderRadius: 10,
    padding: 10, marginTop: 8,
  },

  attOk: { borderWidth:1, borderColor:'#B8E2C8', backgroundColor:'#E6F4EA', borderRadius: 12, paddingHorizontal:8, paddingVertical:4 },
  attOkTxt: { color:'#0E7A3E', fontWeight:'800' },
  attNo: { borderWidth:1, borderColor:'#F7D2CD', backgroundColor:'#FDECEA', borderRadius: 12, paddingHorizontal:8, paddingVertical:4 },
  attNoTxt: { color:'#B00020', fontWeight:'800' },

  badge: { borderWidth:1, borderRadius: 12, paddingHorizontal: 8, paddingVertical:  4 },
  badgeTxt: { fontWeight:'800' },

  dropdownTrigger: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    height: 44, paddingHorizontal: 12, backgroundColor: '#fff',
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
  },
  dropdownText: { color: NAVY, fontWeight:'700', flex: 1, marginRight: 8 },
  dropdownCaret: { color: MUTED, fontWeight:'800' },
  dropdownCard: {
    position:'absolute',
    left: 20, right: 20, top: '20%',
    backgroundColor:'#fff',
    borderRadius:12,
    borderWidth:1, borderColor:BORDER,
    paddingVertical: 6,
    shadowColor:'#000', shadowOpacity:0.15, shadowRadius:12, elevation:6,
  },

  switch: {
    width: 44, height: 24, borderRadius: 12, borderWidth:1,
    borderColor: '#FFD5DB',
    backgroundColor: '#FFE8EB',
    justifyContent:'center',
  },
  switchOn: { backgroundColor: RED, borderColor: RED },
  knob: {
    width: 18, height: 18, borderRadius: 9, backgroundColor:'#fff',
    marginLeft: 3, shadowColor:'#000', shadowOpacity:0.1, shadowRadius:2, elevation:2,
  },
  knobOn: { marginLeft: 23 },

  modalBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.35)' },
  modalCard: {
    position:'absolute',
    left:16, right:16, top:'18%',
    backgroundColor:'#fff',
    borderRadius:12,
    borderWidth:1, borderColor:BORDER,
    padding:12,
    shadowColor:'#000', shadowOpacity:0.15, shadowRadius:12, elevation:6,
  },
  modalCardLarge: {
    position:'absolute',
    left:16, right:16, top:'12%',
    backgroundColor:'#fff',
    borderRadius:12,
    borderWidth:1, borderColor:BORDER,
    padding:12,
    maxHeight: '76%',
    shadowColor:'#000', shadowOpacity:0.15, shadowRadius:12, elevation:6,
  },
  menuCancel: {
    color: NAVY, fontWeight:'700', textAlign:'center', paddingVertical:10,
    borderRadius:10, borderWidth:1, borderColor:BORDER, backgroundColor:'#fff',
  },
});

const st = StyleSheet.create({
  selectMenu: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, backgroundColor:'#fff',
  },
  selectItem: {
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  selectItemActive: { backgroundColor:'#EDEFF3' },
  selectItemText: { color: NAVY, fontWeight: '700' },
  selectItemTextActive: { color: NAVY, fontWeight: '800' },
});
