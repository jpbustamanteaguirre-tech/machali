// app/(tabs)/attendance.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import {
  collection,
  doc,
  getDoc,
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
  KeyboardAvoidingView,
  LayoutChangeEvent,
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
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';
import { getFabStyle } from '../../src/theme/layout';
import { getCategory } from '../../src/utils/category';

const BG = '#F7F8FA';
const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BORDER = '#E6E8EC';
const MUTED = '#8A98A8';
const CHIP_BG = '#EDEFF3';

// 🔹 clave de caché versionada
const K_ATTENDANCE_STATE = 'attendance_tab_state_v1';

type DayKey = 'Lunes'|'Martes'|'Miércoles'|'Jueves'|'Viernes'|'Sábado'|'Domingo';
type TimeRange = { start: string; end: string };
type Schedule = Record<DayKey, TimeRange[]>;

type Group = {
  id: string;
  name: string;
  athleteIds?: string[];
  schedule?: Schedule;
};

type Athlete = {
  id: string;
  name: string;          // display (normalizado)
  birth?: string;        // ISO YYYY-MM-DD
  seasonYear?: number;
  status?: 'pending'|'active'|'inactive';
};

// ✅ incluye groupId para separar asistencia por grupo
type AttendanceDoc = {
  athleteId: string;
  sessionDate: string;   // ISO YYYY-MM-DD
  groupId: string;
  present: boolean;
  justified?: boolean;
  justifiedReason?: string | null;
  createdAt: any;
};

type AttendanceMeta = {
  sessionDate: string;     // ISO
  cancelled?: boolean;
  cancelReason?: string | null;
  exGroupIds?: string[];   // grupos con entrenamiento excepcional ese día
};

const DAYS: DayKey[] = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

function toTitleCase(s: string) {
  return (s || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(w => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}
function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2,'0');
  const d = String(now.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function getDayKeyFromISO(iso: string): DayKey {
  const d = new Date(iso + 'T00:00:00Z'); // UTC
  return DAYS[(d.getUTCDay() + 6) % 7]; // lunes=0
}
function getAgeFromISO(iso?: string): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [_, yy, mm, dd] = m;
  const birth = new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd)));
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getUTCFullYear();
  const hadBDay = (now.getMonth() > (Number(mm) - 1)) ||
                  (now.getMonth() === (Number(mm) - 1) && now.getDate() >= Number(dd));
  if (!hadBDay) age -= 1;
  return age;
}

// Calendario compacto
function getMonthMatrix(year: number, monthIndex0: number) {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const cells: Array<{ day: number | null; iso?: string }> = [];
  for (let i = 0; i < startDow; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(monthIndex0 + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day: d, iso });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null });
  const rows: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export default function AttendanceTabTake() {
  const { profile } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.role === 'coach';
  const insets = useSafeAreaInsets();
  const { dateISO } = useLocalSearchParams<{ dateISO?: string }>();

  // Header medido
  const [headerH, setHeaderH] = useState(0);
  const onHeaderLayout = (e: LayoutChangeEvent) => setHeaderH(e.nativeEvent.layout.height);

  // Estado base
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  // Fecha + calendario
  const [selectedISO, setSelectedISO] = useState<string>(dateISO || todayISO());
  const current = useMemo(() => new Date(selectedISO + 'T00:00:00Z'), [selectedISO]);
  const y = current.getUTCFullYear();
  const m0 = current.getUTCMonth();
  const monthRows = useMemo(() => getMonthMatrix(y, m0), [y, m0]);
  const dayKeyToday = useMemo<DayKey>(() => getDayKeyFromISO(selectedISO), [selectedISO]);

  // Asistencia existente del día (por grupo)
  const [presentMap, setPresentMap] = useState<Record<string, boolean>>({});
  const [justMap, setJustMap] = useState<Record<string, boolean>>({});
  const [reasonMap, setReasonMap] = useState<Record<string, string>>({});

  // Local editable
  const [localPresent, setLocalPresent] = useState<Record<string, boolean>>({});
  const [localJust, setLocalJust] = useState<Record<string, boolean>>({});
  const [localReason, setLocalReason] = useState<Record<string, string>>({});
  const [absentChosen, setAbsentChosen] = useState<Record<string, boolean>>({});

  // Meta del día
  const [meta, setMeta] = useState<AttendanceMeta | null>(null);

  // Menú y filtro de grupo
  const [menuOpen, setMenuOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupFilterName, setGroupFilterName] = useState<string>('Todos');

  // Modales de acción
  const [editUnlocked, setEditUnlocked] = useState(false);
  const isPastDay = useMemo(() => selectedISO < todayISO(), [selectedISO]);

  const [confirmEditOpen, setConfirmEditOpen] = useState(false);
  const [confirmEditText, setConfirmEditText] = useState('');

  const [exOpen, setExOpen] = useState(false);
  const [exGroupId, setExGroupId] = useState<string | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const [justModalOpen, setJustModalOpen] = useState(false);
  const [justTempReason, setJustTempReason] = useState('');
  const [justForAthlete, setJustForAthlete] = useState<Athlete | null>(null);

  // 🔹 Hidratación inicial desde caché
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(K_ATTENDANCE_STATE);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.athletes)) setAthletes(parsed.athletes);
          if (Array.isArray(parsed.groups)) setGroups(parsed.groups);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  // 🔹 Suscripciones online + persistencia a caché
  useEffect(() => {
    const qy = query(collection(db, 'athletes'), orderBy('name', 'asc'));
    const unsubAth = onSnapshot(
      qy,
      (snap) => {
        const arr: Athlete[] = [];
        snap.forEach(d => {
          const a = { id: d.id, ...(d.data() as any) } as Athlete;
          a.name = toTitleCase(a.name || '');
          arr.push(a);
        });
        setAthletes(arr);
        persistAttendanceCache(arr, groups);
      },
      () => {} // silencioso: el caché ya hidrata la UI
    );

    const unsubGrp = onSnapshot(
      query(collection(db, 'groups')),
      (snap) => {
        const arr: Group[] = [];
        snap.forEach(d => arr.push({ id: d.id, ...(d.data() as any) }));
        arr.sort((a,b)=> (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity:'base' }));
        setGroups(arr);
        persistAttendanceCache(athletes, arr);
      },
      () => {}
    );

    return () => { unsubAth(); unsubGrp(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Grupos con horario HOY o excepcionales
  const exGroupIds = meta?.exGroupIds ?? [];
  const groupsToday = useMemo(() => {
    return groups.filter(g => {
      const sch = g.schedule ? g.schedule[dayKeyToday] : undefined;
      const hasSchedule = Array.isArray(sch) && sch.length > 0;
      const exceptional = exGroupIds.includes(g.id);
      return hasSchedule || exceptional;
    });
  }, [groups, dayKeyToday, exGroupIds]);

  // Auto-seleccionar el primer grupo del día si no hay ninguno elegido
  useEffect(() => {
    if (groupFilterName === 'Todos' && groupsToday.length > 0) {
      setGroupFilterName(groupsToday[0].name);
    }
  }, [groupsToday, groupFilterName]);

  // Grupo seleccionado -> id
  const selectedGroupId = useMemo(() => {
    if (groupFilterName === 'Todos') return null;
    return groupsToday.find(g => g.name === groupFilterName)?.id || null;
  }, [groupFilterName, groupsToday]);

  // Cargar asistencia del día **por grupo**
  useEffect(() => {
    if (!selectedGroupId) {
      setPresentMap({});
      setJustMap({});
      setReasonMap({});
      setLocalPresent({});
      setLocalJust({});
      setLocalReason({});
      setAbsentChosen({});
      return;
    }

    const qy = query(
      collection(db, 'attendance'),
      where('sessionDate', '==', selectedISO),
      where('groupId', '==', selectedGroupId)
    );
    const unsub = onSnapshot(qy, (snap) => {
      const p: Record<string, boolean> = {};
      const j: Record<string, boolean> = {};
      const r: Record<string, string> = {};
      snap.forEach(d => {
        const it = d.data() as AttendanceDoc;
        if (!it.athleteId) return;
        p[it.athleteId] = !!it.present;
        j[it.athleteId] = !!it.justified;
        if (it.justifiedReason) r[it.athleteId] = it.justifiedReason;
      });
      setPresentMap(p);
      setJustMap(j);
      setReasonMap(r);
      setLocalPresent(p);
      setLocalJust(j);
      setLocalReason(r);

      const abs: Record<string, boolean> = {};
      const allIds = new Set<string>(Object.keys(p).concat(Object.keys(j)));
      Array.from(allIds).forEach(id => { abs[id] = !p[id] && !j[id]; });
      setAbsentChosen(abs);
    });
    return unsub;
  }, [selectedISO, selectedGroupId]);

  // Cargar meta del día
  useEffect(() => {
    const ref = doc(db, 'attendanceMeta', selectedISO);
    let active = true;
    (async () => {
      const snap = await getDoc(ref);
      if (!active) return;
      if (snap.exists()) setMeta({ sessionDate: selectedISO, ...(snap.data() as any) });
      else setMeta({ sessionDate: selectedISO });
    })();
    return () => { active = false; };
  }, [selectedISO]);

  // Mapa atleta -> nombre del primer grupo del día
  const athleteGroupName: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    groupsToday.forEach(g => (g.athleteIds ?? []).forEach(aid => { if (!map[aid]) map[aid] = g.name; }));
    return map;
  }, [groupsToday]);

  // IDs visibles (del grupo seleccionado)
  const visibleAthleteIdsSet = useMemo(() => {
    if (!selectedGroupId) return new Set<string>();
    const ids = new Set<string>();
    groupsToday.forEach(g => {
      if (g.id !== selectedGroupId) return;
      (g.athleteIds ?? []).forEach(aid => ids.add(aid));
    });
    return ids;
  }, [groupsToday, selectedGroupId]);

  // Filtrado final (solo grupo seleccionado; excluir 'inactive')
  const filtered = useMemo(() => {
    return athletes
      .filter(a => a.status !== 'inactive')
      .filter(a => visibleAthleteIdsSet.has(a.id));
  }, [athletes, visibleAthleteIdsSet]);

  // Métricas (excluye justificados)
  const justifiedCount = useMemo(
    () => filtered.reduce((acc, a) => acc + (localJust[a.id] ? 1 : 0), 0),
    [filtered, localJust]
  );
  const presentCount = useMemo(
    () => filtered.reduce((acc, a) => acc + (localPresent[a.id] && !localJust[a.id] ? 1 : 0), 0),
    [filtered, localPresent, localJust]
  );
  const effectiveTotal = useMemo(() => filtered.length - justifiedCount, [filtered.length, justifiedCount]);

  const chosenCount = useMemo(
    () => filtered.reduce((acc, a) => {
      const any = !!localPresent[a.id] || !!localJust[a.id] || !!absentChosen[a.id];
      return acc + (any ? 1 : 0);
    }, 0),
    [filtered, localPresent, localJust, absentChosen]
  );

  // Navegación mes
  const goPrevMonth = () => {
    const d = new Date(Date.UTC(y, m0 - 1, 1));
    setSelectedISO(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`);
  };
  const goNextMonth = () => {
    const d = new Date(Date.UTC(y, m0 + 1, 1));
    setSelectedISO(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`);
  };
  const setToday = () => setSelectedISO(todayISO());

  // Guardar (por grupo)
  const doSave = async () => {
    try {
      if (!canManage) {
        Alert.alert('Sin permiso', 'No puedes guardar asistencia.');
        return;
      }
      if (meta?.cancelled) {
        Alert.alert('Día cancelado', 'No puedes guardar asistencia en un día cancelado.');
        return;
      }
      if (!selectedGroupId) {
        Alert.alert('Selecciona grupo', 'Debes seleccionar un grupo para guardar asistencia.');
        return;
      }
      if (chosenCount === 0) {
        Alert.alert('Ups', 'Selecciona al menos un nadador con asistencia antes de guardar.');
        return;
      }

      const ops: Promise<any>[] = [];
      filtered.forEach(a => {
        const docId = `${a.id}_${selectedISO}_${selectedGroupId}`;
        ops.push(
          setDoc(doc(db, 'attendance', docId), {
            athleteId: a.id,
            sessionDate: selectedISO,
            groupId: selectedGroupId,
            present: !!localPresent[a.id],
            justified: !!localJust[a.id],
            justifiedReason: localJust[a.id] ? (localReason[a.id] || null) : null,
            createdAt: serverTimestamp(),
          } as AttendanceDoc, { merge: true })
        );
      });
      await Promise.all(ops);
      Alert.alert('Listo', 'Asistencia guardada.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo guardar la asistencia');
    }
  };

  const kbBehavior = Platform.OS === 'ios' ? 'padding' : 'height';
  const kbOffset = Platform.OS === 'ios' ? 0 : 56;
  const isEditable = canManage && (!isPastDay || editUnlocked) && !meta?.cancelled;

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
      {/* Header azul */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }} onLayout={onHeaderLayout}>
        <View style={hd.headerRow}>
          <Text style={hd.headerTitle}>Asistencia</Text>
          <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={{ top:8,bottom:8,left:8,right:8 }}>
            <Text style={hd.menuIcon}>☰</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={kbBehavior} keyboardVerticalOffset={kbOffset}>
        {loading ? (
          <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            {/* Tabs superiores */}
            <View style={ui.card}>
              <View style={{ flexDirection:'row', gap: 8 }}>
                <TouchableOpacity disabled style={[ui.tabBtn, ui.tabBtnOn]}>
                  <Text style={[ui.tabTxt, ui.tabTxtOn]}>Tomar asistencia</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/attendance/history')} style={ui.tabBtn}>
                  <Text style={ui.tabTxt}>Historial</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Lista */}
            <FlatList
              data={filtered}
              keyExtractor={(i) => i.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              removeClippedSubviews
              windowSize={8}
              initialNumToRender={18}
              contentContainerStyle={{ paddingBottom: 8 }}
              ListHeaderComponent={
                <>
                  {/* Calendario */}
                  <View style={ui.card}>
                    <View style={cal.header}>
                      <TouchableOpacity onPress={goPrevMonth} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
                        <Text style={cal.nav}>‹</Text>
                      </TouchableOpacity>
                      <Text style={cal.title}>
                        {current.toLocaleString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                      </Text>
                      <TouchableOpacity onPress={goNextMonth} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
                        <Text style={cal.nav}>›</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={cal.weekHeader}>
                      {['L','M','X','J','V','S','D'].map(k => (
                        <Text key={k} style={cal.weekText}>{k}</Text>
                      ))}
                    </View>

                    {monthRows.map((r, idx) => (
                      <View key={idx} style={cal.weekRow}>
                        {r.map((c, i) => {
                          const isSelected = c.iso === selectedISO;
                          const isClickable = !!c.day;
                          return (
                            <TouchableOpacity
                              key={i}
                              disabled={!isClickable}
                              onPress={() => { if (c.iso) setSelectedISO(c.iso); }}
                              style={[
                                cal.dayCell,
                                isSelected && cal.dayOn,
                                !isClickable && { opacity: 0.4 },
                              ]}
                            >
                              <Text style={[cal.dayTxt, isSelected && cal.dayTxtOn]}>
                                {c.day ?? ''}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}

                    {/* Chips de fecha */}
                    <View style={{ flexDirection:'row', alignItems:'center', marginTop: 6 }}>
                      <TouchableOpacity onPress={setToday} style={ui.btnMini}>
                        <Text style={ui.btnMiniTxt}>Hoy</Text>
                      </TouchableOpacity>
                      <View style={[ui.datePill, { marginLeft: 8 }]}>
                        <Text style={ui.datePillTxt}>{current.toLocaleDateString('es-CL', { timeZone: 'UTC' })}</Text>
                      </View>
                      {meta?.cancelled ? (
                        <View style={[ui.badge, { backgroundColor:'#FDE7EA', borderColor:'#F5C3CC' }]}>
                          <Text style={[ui.badgeTxt, { color:'#B00020' }]}>Día cancelado</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Filtro de Grupo (hoy) */}
                    <View style={{ marginTop: 8 }}>
                      <TouchableOpacity
                        onPress={() => setGroupOpen(true)}
                        activeOpacity={0.9}
                        style={ui.groupFilterChip}
                      >
                        <Text style={ui.groupFilterLabel}>Grupo</Text>
                        <Text style={ui.groupFilterValue} numberOfLines={1}>{groupFilterName}</Text>
                        <Text style={ui.groupFilterCaret}>▾</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Métricas + acciones */}
                  <View style={{ paddingHorizontal: 16, marginTop: 6 }}>
                    <Text style={{ color: MUTED }}>
                      {presentCount} presentes de {effectiveTotal} (excluye justificados)
                    </Text>
                    <View style={{ flexDirection:'row', marginTop: 8 }}>
                      <TouchableOpacity
                        onPress={() => {
                          if (!isEditable) return;
                          const nextP = { ...localPresent };
                          const nextJ = { ...localJust };
                          const nextAbs = { ...absentChosen };
                          filtered.forEach(a => { nextP[a.id] = true; nextJ[a.id] = false; nextAbs[a.id] = false; });
                          setLocalPresent(nextP);
                          setLocalJust(nextJ);
                          setAbsentChosen(nextAbs);
                        }}
                        style={ui.btnGhost}
                      >
                        <Text style={ui.btnGhostTxt}>Todos presentes</Text>
                      </TouchableOpacity>
                      <View style={{ width: 6 }} />
                      <TouchableOpacity
                        onPress={() => {
                          if (!isEditable) return;
                          const nextP: Record<string, boolean> = { ...localPresent };
                          const nextJ: Record<string, boolean> = { ...localJust };
                          const nextR: Record<string, string> = { ...localReason };
                          const nextAbs: Record<string, boolean> = { ...absentChosen };
                          filtered.forEach(a => {
                            nextP[a.id] = false;
                            nextJ[a.id] = false;
                            nextAbs[a.id] = false;
                            delete nextR[a.id];
                          });
                          setLocalPresent(nextP);
                          setLocalJust(nextJ);
                          setLocalReason(nextR);
                          setAbsentChosen(nextAbs);
                        }}
                        style={ui.btnGhost}
                      >
                        <Text style={ui.btnGhostTxt}>Limpiar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              }
              ListEmptyComponent={
                <View style={{ padding: 16 }}>
                  <Text style={{ color: NAVY }}>
                    {groupsToday.length === 0
                      ? 'No hay grupos programados para este día.'
                      : (selectedGroupId ? 'Sin nadadores para los filtros actuales.' : 'Selecciona un grupo para listar nadadores.')}
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const age = getAgeFromISO(item.birth);
                const catEff = getCategory(item.birth, item.seasonYear) || '—';
                const groupName = athleteGroupName[item.id] ?? '—';

                const present = !!localPresent[item.id];
                const justified = !!localJust[item.id];
                const absChosen = !!absentChosen[item.id];
                const disabled = !isEditable;

                return (
                  <View style={ui.row}>
                    <View style={{ flex:1 }}>
                      <Text style={{ color: NAVY, fontWeight:'800' }}>{toTitleCase(item.name)}</Text>
                      <Text style={{ color: MUTED, marginTop: 2 }}>
                        {age != null ? `${age} años` : '—'} · {catEff}
                      </Text>
                      <Text style={{ color: MUTED, marginTop: 2 }}>Grupo: {groupName}</Text>
                    </View>

                    {/* Controles */}
                    <View style={{ alignItems:'flex-end' }}>
                      <View style={{ flexDirection:'row', gap: 6 }}>
                        {(!absChosen && !justified) ? (
                          <TouchableOpacity
                            disabled={disabled}
                            onPress={() => {
                              if (disabled) return;
                              setLocalPresent(prev => ({ ...prev, [item.id]: !present ? true : false }));
                              setLocalJust(prev => ({ ...prev, [item.id]: false }));
                              setAbsentChosen(prev => ({ ...prev, [item.id]: false }));
                            }}
                            style={[btn.toggle, present ? btn.on : btn.off, disabled && btn.disabled]}
                          >
                            <Text style={[btn.txt, present && btn.txtOn]}>Presente</Text>
                          </TouchableOpacity>
                        ) : null}

                        <TouchableOpacity
                          disabled={disabled}
                          onPress={() => {
                            if (disabled) return;
                            const next = !absChosen;
                            setAbsentChosen(prev => ({ ...prev, [item.id]: next }));
                            setLocalPresent(prev => ({ ...prev, [item.id]: false }));
                            setLocalJust(prev => ({ ...prev, [item.id]: false }));
                          }}
                          style={[btn.toggle, (absChosen && !justified) ? btn.onWarn : btn.off, disabled && btn.disabled]}
                        >
                          <Text style={[btn.txt, (absChosen && !justified) && btn.txtWarn]}>Ausente</Text>
                        </TouchableOpacity>

                        {(absChosen && !justified) ? (
                          <TouchableOpacity
                            disabled={disabled}
                            onPress={() => {
                              if (disabled) return;
                              setJustForAthlete(item);
                              setJustTempReason(localReason[item.id] || '');
                              setJustModalOpen(true);
                            }}
                            style={[btn.toggle, btn.just, disabled && btn.disabled]}
                          >
                            <Text style={[btn.txt, btn.txtJust]}>Justificar</Text>
                          </TouchableOpacity>
                        ) : null}

                        {justified ? (
                          <TouchableOpacity
                            disabled={disabled}
                            onPress={() => {
                              if (disabled) return;
                              setLocalJust(prev => ({ ...prev, [item.id]: false }));
                              setAbsentChosen(prev => ({ ...prev, [item.id]: true }));
                            }}
                            style={[btn.toggle, btn.justOn, disabled && btn.disabled]}
                          >
                            <Text style={[btn.txt, btn.txtJustOn]}>Justificado</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              }}
            />

            {/* FAB */}
            {canManage && !meta?.cancelled && (
              <>
                {isPastDay && !editUnlocked ? (
                  <TouchableOpacity
                    onPress={() => { setConfirmEditText(''); setConfirmEditOpen(true); }}
                    style={[{ backgroundColor: RED, borderRadius: 28, paddingHorizontal: 18, paddingVertical: 14 }, getFabStyle(insets)]}
                    activeOpacity={0.9}
                  >
                    <Text style={{ color:'#fff', fontWeight:'800' }}>Editar</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={doSave}
                    style={[
                      { backgroundColor: RED, borderRadius: 28, paddingHorizontal: 18, paddingVertical: 14 },
                      getFabStyle(insets),
                      (!isEditable || chosenCount===0) && { opacity: 0.5 },
                    ]}
                    activeOpacity={0.9}
                    disabled={!isEditable || chosenCount === 0}
                  >
                    <Text style={{ color:'#fff', fontWeight:'800' }}>Guardar</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </>
        )}
      </KeyboardAvoidingView>

      {/* ===== Menú ☰ ===== */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={hd.modalBackdrop} onPress={() => setMenuOpen(false)} />
        <View style={[hd.menuSheet, { top: headerH || 64 }]}>
          <Text style={hd.menuTitle}>Opciones</Text>

          {(canManage) && (
            <>
              <Text style={st.sec}>Acciones del día</Text>

              <TouchableOpacity onPress={() => { setExGroupId(null); setExOpen(true); }} style={st.actionBtn}>
                <Text style={st.actionTxt}>Entrenamiento excepcional</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => { setCancelReason(''); setCancelOpen(true); }} style={[st.actionBtn, { marginTop: 8 }]}>
                <Text style={st.actionTxt}>Cancelar entrenamiento</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity onPress={() => setMenuOpen(false)} style={{ marginTop: 10 }}>
            <Text style={hd.menuCancel}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ===== Modal: GRUPO (hoy) ===== */}
      <Modal
        transparent
        visible={groupOpen}
        animationType="fade"
        onRequestClose={() => setGroupOpen(false)}
      >
        <Pressable style={hd.modalBackdrop} onPress={() => setGroupOpen(false)} />
        <View style={st.sheet}>
          <Text style={st.sheetTitle}>Seleccionar grupo</Text>
          <View style={{ maxHeight: 360 }}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                onPress={() => { setGroupFilterName('Todos'); setGroupOpen(false); }}
                style={st.selectItem}
              >
                <Text style={st.selectItemText}>Todos</Text>
              </TouchableOpacity>

              {groupsToday.map(g => (
                <TouchableOpacity
                  key={g.id}
                  onPress={() => { setGroupFilterName(g.name); setGroupOpen(false); }}
                  style={st.selectItem}
                >
                  <Text style={st.selectItemText}>{g.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={{ flexDirection:'row', justifyContent:'flex-end', marginTop:10 }}>
            <TouchableOpacity onPress={() => setGroupOpen(false)} style={[st.smallBtn, { backgroundColor: MUTED }]}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal EDITAR día pasado */}
      <Modal transparent visible={confirmEditOpen} animationType="fade" onRequestClose={() => setConfirmEditOpen(false)}>
        <Pressable style={hd.modalBackdrop} onPress={() => setConfirmEditOpen(false)} />
        <View style={st.sheet}>
          <Text style={st.sheetTitle}>Editar día pasado</Text>
          <Text style={{ color: NAVY, marginBottom: 8 }}>
            Para habilitar la edición escribe <Text style={{ fontWeight:'800' }}>EDITAR</Text>.
          </Text>
          <TextInput
            value={confirmEditText}
            onChangeText={setConfirmEditText}
            placeholder="EDITAR"
            placeholderTextColor={MUTED}
            style={ui.input}
            autoCapitalize="characters"
          />
          <View style={{ flexDirection:'row', justifyContent:'flex-end', gap: 8, marginTop: 10 }}>
            <TouchableOpacity onPress={() => setConfirmEditOpen(false)} style={[st.smallBtn, { backgroundColor: MUTED }]}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (confirmEditText.trim().toUpperCase() !== 'EDITAR') {
                  Alert.alert('Confirma', 'Escribe EDITAR para continuar.');
                  return;
                }
                setEditUnlocked(true);
                setConfirmEditOpen(false);
              }}
              style={[st.smallBtn, { backgroundColor: RED }]}
            >
              <Text style={{ color:'#fff', fontWeight:'800' }}>Habilitar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal JUSTIFICAR */}
      <Modal transparent visible={justModalOpen} animationType="fade" onRequestClose={() => setJustModalOpen(false)}>
        <Pressable style={hd.modalBackdrop} onPress={() => setJustModalOpen(false)} />
        <View style={st.sheet}>
          <Text style={st.sheetTitle}>Justificar inasistencia</Text>
          <Text style={{ color: NAVY, marginBottom: 8 }}>Motivo (obligatorio):</Text>
          <TextInput
            value={justTempReason}
            onChangeText={setJustTempReason}
            placeholder="Ej: Enfermedad"
            placeholderTextColor={MUTED}
            style={[ui.input, { height: 44 }]}
          />
          <View style={{ flexDirection:'row', justifyContent:'flex-end', gap:8, marginTop: 10 }}>
            <TouchableOpacity onPress={() => setJustModalOpen(false)} style={[st.smallBtn, { backgroundColor: MUTED }]}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (!justForAthlete) return;
                if (!justTempReason.trim()) {
                  Alert.alert('Motivo requerido', 'Ingresa un motivo para justificar.');
                  return;
                }
                setLocalPresent(prev => ({ ...prev, [justForAthlete.id]: false }));
                setLocalJust(prev => ({ ...prev, [justForAthlete.id]: true }));
                setLocalReason(prev => ({ ...prev, [justForAthlete.id]: justTempReason.trim() }));
                setAbsentChosen(prev => ({ ...prev, [justForAthlete.id]: false }));
                setJustModalOpen(false);
                setJustForAthlete(null);
                setJustTempReason('');
              }}
              style={[st.smallBtn, { backgroundColor: RED }]}
            >
              <Text style={{ color:'#fff', fontWeight:'800' }}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal ENTRENAMIENTO EXCEPCIONAL */}
      <Modal transparent visible={exOpen} animationType="fade" onRequestClose={() => setExOpen(false)}>
        <Pressable style={hd.modalBackdrop} onPress={() => setExOpen(false)} />
        <View style={st.sheet}>
          <Text style={st.sheetTitle}>Entrenamiento excepcional</Text>
          <Text style={{ color: NAVY, marginBottom: 6 }}>Selecciona el grupo destino:</Text>
          <View style={{ marginTop: 4 }}>
            <View style={st.selectTrigger}>
              <Text style={st.selectText} numberOfLines={1}>
                {exGroupId ? (groups.find(g => g.id === exGroupId)?.name ?? 'Grupo') : 'Elegir grupo'}
              </Text>
              <Text style={st.selectCaret}>▾</Text>
            </View>
            <View style={[st.selectMenu, { marginTop: 6, maxHeight: 240 }]}>
              {groups.map(g => (
                <TouchableOpacity key={g.id} onPress={() => setExGroupId(g.id)} style={st.selectItem}>
                  <Text style={st.selectItemText}>{g.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={{ flexDirection:'row', justifyContent:'flex-end', gap:8, marginTop: 12 }}>
            <TouchableOpacity onPress={() => setExOpen(false)} style={[st.smallBtn, { backgroundColor: MUTED }]}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                if (!exGroupId) { Alert.alert('Falta grupo', 'Selecciona un grupo.'); return; }
                try {
                  const ref = doc(db, 'attendanceMeta', selectedISO);
                  const snap = await getDoc(ref);
                  const prev = (snap.exists() ? (snap.data() as any).exGroupIds : []) ?? [];
                  const uniq = Array.from(new Set([...prev, exGroupId]));
                  await setDoc(ref, { sessionDate: selectedISO, exGroupIds: uniq }, { merge: true });
                  setExOpen(false);
                  setMenuOpen(false);
                  Alert.alert('OK', 'Entrenamiento excepcional creado.');
                } catch (e: any) {
                  Alert.alert('Error', e?.message ?? 'No se pudo crear el entrenamiento excepcional');
                }
              }}
              style={[st.smallBtn, { backgroundColor: RED }]}
            >
              <Text style={{ color:'#fff', fontWeight:'800' }}>Confirmar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal CANCELAR ENTRENAMIENTO */}
      <Modal transparent visible={cancelOpen} animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <Pressable style={hd.modalBackdrop} onPress={() => setCancelOpen(false)} />
        <View style={st.sheet}>
          <Text style={st.sheetTitle}>Cancelar entrenamiento</Text>
          <Text style={{ color: NAVY, marginBottom: 6 }}>Motivo (obligatorio):</Text>
          <TextInput
            value={cancelReason}
            onChangeText={setCancelReason}
            placeholder="Ej: Corte de agua"
            placeholderTextColor={MUTED}
            style={ui.input}
          />
          <View style={{ flexDirection:'row', justifyContent:'flex-end', gap:8, marginTop: 12 }}>
            <TouchableOpacity onPress={() => setCancelOpen(false)} style={[st.smallBtn, { backgroundColor: MUTED }]}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                if (!cancelReason.trim()) { Alert.alert('Motivo requerido', 'Describe el motivo.'); return; }
                try {
                  await setDoc(doc(db, 'attendanceMeta', selectedISO), {
                    sessionDate: selectedISO,
                    cancelled: true,
                    cancelReason,
                  }, { merge: true });
                  setCancelOpen(false);
                  setMenuOpen(false);
                  Alert.alert('Día cancelado', 'No contará para nadie.');
                } catch (e: any) {
                  Alert.alert('Error', e?.message ?? 'No se pudo cancelar el día');
                }
              }}
              style={[st.smallBtn, { backgroundColor: RED }]}
            >
              <Text style={{ color:'#fff', fontWeight:'800' }}>Confirmar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** 🔸 Persistir snapshot para uso offline */
async function persistAttendanceCache(athletes: Athlete[], groups: Group[]) {
  try {
    const payload = { athletes, groups, updatedAt: Date.now() };
    await AsyncStorage.setItem(K_ATTENDANCE_STATE, JSON.stringify(payload));
  } catch {}
}

/* ===== Header / menú ☰ ===== */
const hd = StyleSheet.create({
  headerRow: {
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection:'row',
    alignItems:'center',
    justifyContent:'space-between',
  },
  headerTitle: {
    color:'#fff',
    fontSize:18,
    fontWeight:'700',
    flex:1,
    paddingHorizontal: 12,
    includeFontPadding: false as any,
  },
  menuIcon: { color:'#fff', fontSize:22, fontWeight:'800', includeFontPadding: false as any },

  modalBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.35)' },
  menuSheet: {
    position:'absolute',
    right:12,
    width:300,
    backgroundColor:'#fff',
    borderRadius:12,
    borderWidth:1,
    borderColor:BORDER,
    padding:10,
    shadowColor:'#000',
    shadowOpacity:0.15,
    shadowRadius:12,
    elevation:6,
  },
  menuTitle: { color: NAVY, fontWeight:'800', marginBottom:8 },
  menuCancel: {
    color: NAVY, fontWeight:'700', textAlign:'center', paddingVertical:10,
    borderRadius:10, borderWidth:1, borderColor:BORDER, backgroundColor:'#fff',
  },
});

/* ===== UI ===== */
const ui = StyleSheet.create({
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

  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 44,
    paddingHorizontal: 14, color: NAVY, backgroundColor: '#fff',
  },
  btnMini: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor:'#fff',
  },
  btnMiniTxt: { color: NAVY, fontWeight:'700', fontSize: 12 },
  datePill: { backgroundColor: CHIP_BG, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 },
  datePillTxt: { color: NAVY, fontWeight:'700', fontSize: 12 },

  badge: { marginLeft: 8, borderWidth:1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  badgeTxt: { fontWeight:'800' },

  btnGhost: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor:'#fff',
  },
  btnGhostTxt: { color: NAVY, fontWeight:'700', fontSize: 12 },

  row: {
    flexDirection:'row',
    alignItems:'center',
    backgroundColor:'#fff',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },

  groupFilterChip: {
    flexDirection:'row',
    alignItems:'center',
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    borderRadius: 12,
    height: 36,
    paddingHorizontal: 10,
  },
  groupFilterLabel: { color: MUTED, fontWeight:'700', marginRight: 8, fontSize: 12 },
  groupFilterValue: { color: NAVY, fontWeight:'800', flex: 1 },
  groupFilterCaret: { color: MUTED, fontWeight:'800', marginLeft: 8 },
});

/* ===== Calendario ===== */
const cal = StyleSheet.create({
  header: {
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
    marginBottom: 4, marginTop: 2,
  },
  nav: { color: NAVY, fontSize: 18, fontWeight:'800' },
  title: { color: NAVY, fontWeight:'800' },

  weekHeader: { flexDirection:'row', justifyContent:'space-between', marginBottom: 4 },
  weekText: { width: 24, textAlign:'center', color: MUTED, fontWeight:'700', fontSize: 11 },

  weekRow: { flexDirection:'row', justifyContent:'space-between', marginBottom: 4 },
  dayCell: { width: 24, height: 24, borderRadius: 12, alignItems:'center', justifyContent:'center' },
  dayOn: { backgroundColor: RED },
  dayTxt: { color: NAVY, fontWeight:'700', fontSize: 12 },
  dayTxtOn: { color:'#fff' },
});

/* ===== Botones de estado por atleta ===== */
const btn = StyleSheet.create({
  toggle: { borderRadius: 16, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1 },
  off: { borderColor: BORDER, backgroundColor:'#fff' },
  on: { borderColor: '#B8E2C8', backgroundColor: '#E6F4EA' },
  txt: { color: NAVY, fontWeight:'700', fontSize: 12 },
  txtOn: { color: '#0E7A3E' },

  onWarn: { borderColor: '#F7D2CD', backgroundColor: '#FDECEA' },
  txtWarn: { color: '#B00020', fontWeight:'800' },

  just: { borderColor: '#FFE3B5', backgroundColor: '#FFF5E1' },
  txtJust: { color: '#B85C00', fontWeight:'800' },

  justOn: { borderColor: '#FFD8A8', backgroundColor: '#FFF4E5' },
  txtJustOn: { color: '#B85C00', fontWeight:'800' },

  disabled: { opacity: 0.5 },
});

/* ===== Sheet / Dropdown ===== */
const st = StyleSheet.create({
  sec: { color: NAVY, fontWeight:'800', marginTop: 12, marginBottom: 6 },

  selectTrigger: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 44,
    paddingHorizontal: 12, backgroundColor:'#fff',
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
  },
  selectText: { color: NAVY, fontWeight:'700', flex:1 },
  selectCaret: { color: MUTED, fontWeight:'800' },
  selectMenu: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, backgroundColor:'#fff',
  },
  selectItem: {
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  selectItemText: { color: NAVY, fontWeight: '700' },

  actionBtn: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, backgroundColor:'#fff',
  },
  actionTxt: { color: NAVY, fontWeight:'800' },

  sheet: {
    position:'absolute',
    left:16, right:16, top:'28%',
    backgroundColor: '#fff',
    borderRadius:12, borderWidth:1, borderColor:BORDER,
    padding:12,
    shadowColor:'#000', shadowOpacity:0.15, shadowRadius:12, elevation:6,
  },
  sheetTitle: { color: NAVY, fontWeight:'800', fontSize:16, marginBottom: 8 },
  smallBtn: { borderRadius:10, paddingHorizontal:12, paddingVertical:10 },
});
