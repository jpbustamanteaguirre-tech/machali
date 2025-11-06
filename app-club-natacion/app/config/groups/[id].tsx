import { useFocusEffect } from '@react-navigation/native';
import * as NavigationBar from 'expo-navigation-bar';
import { useLocalSearchParams } from 'expo-router';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../../src/services/firebase';
import { useAuth } from '../../../src/stores/authStore';
import { getFabStyle } from '../../../src/theme/layout';
import { getCategory } from '../../../src/utils/category';

const NAVY = '#0B1E2F';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';
const RED = '#CE2434';
const MUTED = '#8A98A8';
const GREEN = '#0E7A3E';
const WHITE = '#fff';

type Role = 'admin' | 'coach' | 'athlete' | 'guardian';
type Group = {
  id: string;
  name: string;
  headCoachId?: string | null;
  assistantCoachIds?: string[];
  athleteIds?: string[];
  schedule?: Schedule;
};
type User = { uid: string; displayName?: string; role: Role; email?: string };
type Athlete = { id: string; name: string; status?: string; birth?: string };
type DayKey = 'Lunes' | 'Martes' | 'Miércoles' | 'Jueves' | 'Viernes' | 'Sábado' | 'Domingo';
type TimeRange = { start: string; end: string };
type Schedule = Record<DayKey, TimeRange[]>;

const DAYS: DayKey[] = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

const toTitleCase = (s: string) =>
  (s || '').toLowerCase().split(' ').filter(Boolean).map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');

const emptySchedule: Schedule = {
  Lunes: [], Martes: [], Miércoles: [], Jueves: [], Viernes: [], Sábado: [], Domingo: [],
};

const isValidHHMM = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const maskHHMM = (raw: string) => {
  const d = (raw || '').replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return d.slice(0, 2) + ':' + d.slice(2);
};
const eqArray = (a?: string[], b?: string[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
const eqSchedule = (a?: Schedule, b?: Schedule) => JSON.stringify(a ?? emptySchedule) === JSON.stringify(b ?? emptySchedule);

// Edad real (hoy)
const getAgeReal = (iso?: string): number | null => {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [_, y, mo, d] = m;
  const birth = new Date(Date.UTC(+y, +mo - 1, +d));
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getUTCFullYear();
  const hb = now.getMonth() > birth.getUTCMonth() ||
             (now.getMonth() === birth.getUTCMonth() && now.getDate() >= birth.getUTCDate());
  if (!hb) age -= 1;
  return age;
};

export default function GroupDetailEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'coach';

  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<Group | null>(null);

  const [headCoachId, setHeadCoachId] = useState<string | null>(null);
  const [assistantCoachIds, setAssistantCoachIds] = useState<string[]>([]);
  const [athleteIds, setAthleteIds] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<Schedule>(emptySchedule);

  const [origHead, setOrigHead] = useState<string | null>(null);
  const [origAssistants, setOrigAssistants] = useState<string[]>([]);
  const [origSchedule, setOrigSchedule] = useState<Schedule>(emptySchedule);
  const [origAthletes, setOrigAthletes] = useState<string[]>([]);

  const [mode, setMode] = useState<'info' | 'assign' | 'config'>('info');
  const [configLocked, setConfigLocked] = useState(true);

  const [coaches, setCoaches] = useState<User[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [searchAth, setSearchAth] = useState('');

  // Categoría calculada — dropdown
  const seasonYear = new Date().getFullYear();
  const [selectedCategory, setSelectedCategory] = useState<string>('Todas');
  const [catOpen, setCatOpen] = useState(false);

  // Set con atletas asignados en cualquier grupo
  const [assignedInAny, setAssignedInAny] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      NavigationBar.setBackgroundColorAsync(NAVY).catch(() => {});
      NavigationBar.setButtonStyleAsync('light').catch(() => {});
      return () => { setConfigLocked(true); };
    }, [])
  );

  useEffect(() => {
    if (!id) return;

    // Grupo actual
    const unsubG = onSnapshot(doc(db, 'groups', String(id)), (snap) => {
      if (snap.exists()) {
        const g = { id: snap.id, ...(snap.data() as any) } as Group;
        setGroup(g);

        const sch = (g.schedule ?? emptySchedule) as Schedule;
        const normalized: Schedule = { ...emptySchedule, ...sch };

        setHeadCoachId(g.headCoachId ?? null);
        setAssistantCoachIds(g.assistantCoachIds ?? []);
        setAthleteIds(g.athleteIds ?? []);
        setSchedule(normalized);

        setOrigHead(g.headCoachId ?? null);
        setOrigAssistants(g.assistantCoachIds ?? []);
        setOrigSchedule(normalized);
        setOrigAthletes(g.athleteIds ?? []);
      }
      setLoading(false);
    });

    // Entrenadores (admin+coach)
    const qC = query(collection(db, 'users'), where('role', 'in', ['admin','coach']));
    const unsubC = onSnapshot(qC, (snap) => {
      const arr: User[] = [];
      snap.forEach(d => arr.push({ uid: d.id, ...(d.data() as any) }));
      arr.sort((a,b) => (a.displayName ?? '').localeCompare(b.displayName ?? '', 'es', { sensitivity: 'base' }));
      setCoaches(arr);
    });

    // Atletas activos
    const qA = query(collection(db, 'athletes'), where('status','==','active'));
    const unsubA = onSnapshot(qA, (snap) => {
      const arr: Athlete[] = [];
      snap.forEach(d => arr.push({ id: d.id, ...(d.data() as any) } as Athlete));
      arr.sort((a,b) => (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity: 'base' }));
      setAthletes(arr);
    });

    // Todos los grupos
    const unsubAllGroups = onSnapshot(collection(db, 'groups'), (snap) => {
      const set = new Set<string>();
      snap.forEach((d) => {
        const data = d.data() as any;
        (data.athleteIds ?? []).forEach((aid: string) => set.add(aid));
      });
      setAssignedInAny(set);
    });

    return () => { unsubG(); unsubC(); unsubA(); unsubAllGroups(); };
  }, [id]);

  // Map rápido de uid -> displayName (para mostrar siempre nombres)
  const coachName = useMemo(() => {
    const map = new Map<string, string>();
    coaches.forEach(c => map.set(c.uid, c.displayName ?? c.uid));
    return (uid?: string | null) => (uid ? (map.get(uid) ?? uid) : '—');
  }, [coaches]);

  // Categorías únicas + "Todas"
  const categories = useMemo(() => {
    const set = new Set<string>();
    athletes.forEach(a => set.add(getCategory(a.birth, seasonYear)));
    return ['Todas', ...Array.from(set)];
  }, [athletes, seasonYear]);

  // Búsqueda + filtro por categoría (calculada)
  const filteredAthletes = useMemo(() => {
    const t = searchAth.trim().toLowerCase();
    return athletes.filter(a => {
      if (t && !(a.name || '').toLowerCase().includes(t)) return false;
      const cat = getCategory(a.birth, seasonYear);
      if (selectedCategory !== 'Todas' && cat !== selectedCategory) return false;
      return true;
    });
  }, [athletes, searchAth, selectedCategory, seasonYear]);

  const dirtyCoaches = !(headCoachId === origHead && eqArray(assistantCoachIds, origAssistants));
  const dirtySchedule = !eqSchedule(schedule, origSchedule);
  const dirtyAssigns  = !eqArray(athleteIds, origAthletes);
  const configDirty = dirtyCoaches || dirtySchedule;

  const setHeadCoach = (uid: string) => {
    if (!canEdit || configLocked) return;
    setHeadCoachId(uid);
  };
  const toggleAssistant = (uid: string) => {
    if (!canEdit || configLocked) return;
    setAssistantCoachIds(prev => {
      const set = new Set(prev);
      set.has(uid) ? set.delete(uid) : set.add(uid);
      return Array.from(set);
    });
  };
  const addRange = (day: DayKey) => {
    if (!canEdit || configLocked) return;
    setSchedule(prev => ({ ...prev, [day]: [...(prev[day] ?? []), { start: '06:00', end: '07:00' }] }));
  };
  const updateRange = (day: DayKey, idx: number, field: keyof TimeRange, raw: string) => {
    if (!canEdit || configLocked) return;
    const value = maskHHMM(raw);
    setSchedule(prev => {
      const list = [...(prev[day] ?? [])];
      list[idx] = { ...list[idx], [field]: value };
      return { ...prev, [day]: list };
    });
  };
  const removeRange = (day: DayKey, idx: number) => {
    if (!canEdit || configLocked) return;
    setSchedule(prev => {
      const list = [...(prev[day] ?? [])];
      list.splice(idx, 1);
      return { ...prev, [day]: list };
    });
  };

  const toggleAthlete = (aid: string) => {
    if (!canEdit) return;
    setAthleteIds(prev => {
      const set = new Set(prev);
      set.has(aid) ? set.delete(aid) : set.add(aid);
      return Array.from(set);
    });
  };

  // === KeyboardAvoidingView igual que en login ===
  const kbBehavior = Platform.OS === 'ios' ? 'padding' : 'height';

  // === GUARDAR TODO ===
  const saveAll = async () => {
    if (!canEdit || !group) return;

    // validar horarios cuando haya cambios en schedule
    if (dirtySchedule) {
      for (const d of DAYS) {
        const list = schedule[d] ?? [];
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          if (!isValidHHMM(r.start) || !isValidHHMM(r.end)) {
            Alert.alert('Revisa horarios', `Horario inválido en ${d}, fila ${i + 1}. Usa HH:MM.`);
            return;
          }
          if (r.end <= r.start) {
            Alert.alert('Revisa horarios', `El término debe ser mayor que el inicio en ${d}, fila ${i + 1}.`);
            return;
          }
        }
      }
    }

    try {
      await updateDoc(doc(db, 'groups', group.id), {
        headCoachId: headCoachId ?? null,
        assistantCoachIds,
        athleteIds,
        schedule,
      });
      // Actualiza “originales”
      setOrigHead(headCoachId ?? null);
      setOrigAssistants(assistantCoachIds);
      setOrigSchedule(schedule);
      setOrigAthletes(athleteIds);
      if (mode === 'config') setConfigLocked(true);
      Alert.alert('Guardado', 'Cambios aplicados correctamente.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo guardar.');
    }
  };

  // === GUARDAR SOLO ASIGNACIONES ===
  const saveAssignOnly = async () => {
    if (!canEdit || !group) return;
    try {
      await updateDoc(doc(db, 'groups', group.id), { athleteIds });
      setOrigAthletes(athleteIds);
      Alert.alert('Guardado', 'Asignaciones actualizadas.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo guardar asignaciones.');
    }
  };

  if (loading || !group) {
    return (
      <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
        <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: WHITE, fontSize: 18, fontWeight: '700' }}>Grupo</Text>
          </View>
        </SafeAreaView>
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
        <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, bottom:0, height: insets.bottom, backgroundColor: NAVY }} />
      </SafeAreaView>
    );
  }

  const headerSwitcher = (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <View style={styles.switcher3}>
        <TouchableOpacity onPress={() => setMode('info')}   style={[styles.switchBtn3, mode === 'info' && styles.switchBtnActive]}>
          <Text style={[styles.switchTxt, mode === 'info' && styles.switchTxtActive]}>Información</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('assign')} style={[styles.switchBtn3, mode === 'assign' && styles.switchBtnActive]}>
          <Text style={[styles.switchTxt, mode === 'assign' && styles.switchTxtActive]}>Asignar nadadores</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('config')} style={[styles.switchBtn3, mode === 'config' && styles.switchBtnActive]}>
          <Text style={[styles.switchTxt, mode === 'config' && styles.switchTxtActive]}>Configurar grupo</Text>
        </TouchableOpacity>
      </View>

      {mode === 'config' && (
        <View style={styles.lockBar}>
          <Text style={{ color: NAVY, fontWeight:'700', flex:1 }}>
            {configLocked ? 'Edición bloqueada' : 'Edición habilitada'}
          </Text>
          {configLocked ? (
            <TouchableOpacity onPress={() => setConfigLocked(false)} style={styles.lockBtn}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Editar</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setConfigLocked(true)} style={[styles.lockBtn, { backgroundColor: '#8A98A8' }]}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Bloquear</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  // FAB
  const fabBase = {
    backgroundColor: RED,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 14,
    position: 'absolute' as const,
    right: 16,
    zIndex: 100,
    elevation: 8,
  };
  const fabOverNavBar = { bottom: Math.max(16, insets.bottom + 8) };

  // Dropdown de categorías
  const CategoryDropdown = (
    <>
      <TouchableOpacity onPress={() => setCatOpen(true)} activeOpacity={0.8} style={styles.dropdownTrigger}>
        <Text style={styles.dropdownText} numberOfLines={1}>{selectedCategory}</Text>
        <Text style={styles.dropdownCaret}>▾</Text>
      </TouchableOpacity>

      <Modal transparent visible={catOpen} animationType="fade" onRequestClose={() => setCatOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setCatOpen(false)} />
        <View style={styles.dropdownSheet}>
          <ScrollView style={{ maxHeight: 280 }}>
            {categories.map(cat => {
              const active = cat === selectedCategory;
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => { setSelectedCategory(cat); setCatOpen(false); }}
                  style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                >
                  <Text style={[styles.dropdownItemText, active && styles.dropdownItemTextActive]}>{cat}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
      {/* Header azul */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: WHITE, fontSize: 18, fontWeight: '700' }}>{group?.name ?? 'Grupo'}</Text>
        </View>
      </SafeAreaView>

      {/* === Solo KeyboardAvoidingView (igual que login) === */}
      <KeyboardAvoidingView behavior={kbBehavior} style={{ flex:1 }}>
        {/* INFO */}
        {mode === 'info' && (
          <FlatList
            data={[{k:'info'}]}
            keyExtractor={(i)=>i.k}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: Math.max(16, insets.bottom + 16) }}
            ListHeaderComponent={headerSwitcher}
            renderItem={() => {
              const headName = coachName(headCoachId);
              const assistants = (assistantCoachIds ?? []).map(uid => coachName(uid));
              const daysWithSchedules = DAYS.filter(d => (schedule[d] ?? []).length > 0);

              return (
                <View style={styles.card}>
                  <Text style={styles.title}>Entrenador a cargo</Text>
                  <Text style={{ color: NAVY }}>{headName}</Text>

                  <Text style={[styles.title, { marginTop: 10 }]}>Asistentes</Text>
                  <Text style={{ color: NAVY }}>{assistants.length ? assistants.join(', ') : '—'}</Text>

                  <Text style={[styles.title, { marginTop: 10 }]}>Nadadores asignados</Text>
                  {athleteIds.length === 0 ? (
                    <Text style={{ color: MUTED }}>Sin nadadores asignados</Text>
                  ) : (
                    <View style={{ marginTop: 4 }}>
                      {athleteIds.map(aid => {
                        const a = athletes.find(x => x.id === aid);
                        return (
                          <Text key={aid} style={{ color: NAVY }}>
                            • {toTitleCase(a?.name ?? aid)}
                          </Text>
                        );
                      })}
                    </View>
                  )}

                  <Text style={[styles.title, { marginTop: 10 }]}>Horarios por día</Text>
                  {daysWithSchedules.length === 0 ? (
                    <Text style={{ color: MUTED }}>Sin horarios</Text>
                  ) : (
                    daysWithSchedules.map(d => {
                      const ranges = schedule[d]!;
                      return (
                        <View key={d} style={{ marginTop: 4 }}>
                          <Text style={{ color: NAVY, fontWeight:'700' }}>{d}</Text>
                          {ranges.map((r, i) => (
                            <Text key={`${d}-${i}`} style={{ color: '#4A5A6A' }}>
                              {r.start} — {r.end}
                            </Text>
                          ))}
                        </View>
                      );
                    })
                  )}
                </View>
              );
            }}
          />
        )}

        {/* ASIGNAR */}
        {mode === 'assign' && (
          <>
            <FlatList
              data={filteredAthletes}
              keyExtractor={(i) => i.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingVertical: 8, paddingBottom: Math.max(72, insets.bottom + 16) }}
              ListHeaderComponent={
                <>
                  {headerSwitcher}
                  <View style={styles.card}>
                    <Text style={styles.title}>Filtrar</Text>
                    <View style={{ flexDirection:'row', alignItems:'center' }}>
                      <View style={{ flex: 3, marginRight: 8 }}>
                        <TextInput
                          value={searchAth}
                          onChangeText={setSearchAth}
                          placeholder="Buscar por nombre…"
                          placeholderTextColor={MUTED}
                          style={styles.input}
                          returnKeyType="search"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        {CategoryDropdown}
                      </View>
                    </View>
                  </View>
                </>
              }
              ListEmptyComponent={<View style={{ padding: 16 }}><Text style={{ color: NAVY }}>Sin resultados.</Text></View>}
              renderItem={({ item }) => {
                const on = athleteIds.includes(item.id);
                const ageReal = getAgeReal(item.birth) ?? '—';
                const cat = getCategory(item.birth, seasonYear);
                const noGroupAnywhere = !assignedInAny.has(item.id);

                return (
                  <View style={styles.rowCard}>
                    <TouchableOpacity
                      disabled={!canEdit}
                      onPress={() => toggleAthlete(item.id)}
                      style={[styles.rowBtn, on && styles.rowBtnActive]}
                    >
                      <View style={[styles.check, on && styles.checkOn]}>{on && <View style={styles.checkTick} />}</View>
                      <View style={{ marginLeft: 10, flex: 1 }}>
                        <Text style={[styles.rowText, on && styles.rowTextActive, noGroupAnywhere && { color: RED }]}>
                          {toTitleCase(item.name)}
                        </Text>
                        <Text style={{ color: '#4A5A6A', marginTop: 2, fontSize: 12 }}>
                          Edad: {ageReal} · Categoría: {cat}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />

            {/* FAB Guardar (solo asignaciones) */}
            <TouchableOpacity
              onPress={saveAssignOnly}
              style={[fabBase, getFabStyle(insets), fabOverNavBar]}
              activeOpacity={0.9}
            >
              <Text style={{ color:'#fff', fontWeight:'800' }}>Guardar</Text>
            </TouchableOpacity>
          </>
        )}

        {/* CONFIGURAR */}
        {mode === 'config' && (
          <>
            <FlatList
              data={[{k:'coaches'},{k:'schedule'}]}
              keyExtractor={(i)=>i.k}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingVertical: 8, paddingBottom: Math.max(72, insets.bottom + 16) }}
              ListHeaderComponent={headerSwitcher}
              renderItem={({ item }) => {
                if (item.k === 'coaches') {
                  return (
                    <View style={styles.card}>
                      <Text style={styles.title}>Entrenadores</Text>
                      <Text style={{ color: MUTED, marginBottom: 8 }}>
                        {configLocked ? 'Pulsa “Editar” para habilitar cambios.' : 'Edición habilitada: toca para seleccionar.'}
                      </Text>

                      <Text style={styles.section}>Entrenador a cargo</Text>
                      {coaches.map(c => {
                        const active = headCoachId === c.uid;
                        return (
                          <TouchableOpacity
                            key={`head-${c.uid}`}
                            disabled={!canEdit || configLocked}
                            onPress={() => setHeadCoach(c.uid)}
                            style={[styles.rowBtn, active && styles.rowBtnActive, configLocked && styles.disabledRow]}
                          >
                            <View style={[styles.radio, active && styles.radioActive]} />
                            <Text style={[styles.rowText, active && styles.rowTextActive]}>
                              {c.displayName ?? c.uid}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}

                      <Text style={[styles.section, { marginTop: 12 }]}>Asistentes</Text>
                      {coaches.map(c => {
                        const on = assistantCoachIds.includes(c.uid);
                        return (
                          <TouchableOpacity
                            key={`assistant-${c.uid}`}
                            disabled={!canEdit || configLocked}
                            onPress={() => toggleAssistant(c.uid)}
                            style={[styles.rowBtn, on && styles.rowBtnActive, configLocked && styles.disabledRow]}
                          >
                            <View style={[styles.check, on && styles.checkOn]}>{on && <View style={styles.checkTick} />}</View>
                            <Text style={[styles.rowText, on && styles.rowTextActive]}>
                              {c.displayName ?? c.uid}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                }

                // HORARIOS
                return (
                  <View style={styles.card}>
                    <Text style={styles.title}>Planificación semanal</Text>
                    <Text style={{ color: MUTED, marginBottom: 8 }}>
                      {configLocked
                        ? 'Pulsa “Editar” arriba para modificar.'
                        : 'La hora se formatea automáticamente (1900 → 19:00). Puedes agregar múltiples bloques por día.'}
                    </Text>

                    {DAYS.map((day) => {
                      const ranges = schedule[day] ?? [];
                      return (
                        <View key={day} style={styles.dayBlock}>
                          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
                            <Text style={styles.dayTitle}>{day}</Text>
                            {!configLocked && canEdit && (
                              <TouchableOpacity onPress={() => addRange(day)} style={styles.btnMini}>
                                <Text style={styles.btnMiniText}>Agregar horario</Text>
                              </TouchableOpacity>
                            )}
                          </View>

                          {ranges.length === 0 ? (
                            <Text style={{ color: MUTED, marginTop: 6 }}>Sin horarios</Text>
                          ) : (
                            ranges.map((r, idx) => (
                              <View key={`${day}-${idx}`} style={styles.rangeRow}>
                                <View style={{ flex: 1, marginRight: 6 }}>
                                  <Text style={styles.rangeLabel}>Inicio (HH:MM)</Text>
                                  <TextInput
                                    editable={!configLocked && canEdit}
                                    value={r.start}
                                    onChangeText={v => updateRange(day, idx, 'start', v)}
                                    placeholder="06:30"
                                    placeholderTextColor={MUTED}
                                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                                    style={[styles.rangeInput, configLocked && styles.disabledInput]}
                                    maxLength={5}
                                  />
                                </View>
                                <View style={{ flex: 1, marginLeft: 6 }}>
                                  <Text style={styles.rangeLabel}>Término (HH:MM)</Text>
                                  <TextInput
                                    editable={!configLocked && canEdit}
                                    value={r.end}
                                    onChangeText={v => updateRange(day, idx, 'end', v)}
                                    placeholder="08:00"
                                    placeholderTextColor={MUTED}
                                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                                    style={[styles.rangeInput, configLocked && styles.disabledInput]}
                                    maxLength={5}
                                  />
                                </View>
                                {!configLocked && canEdit && (
                                  <TouchableOpacity onPress={() => removeRange(day, idx)} style={styles.btnDel}>
                                    <Text style={{ color: WHITE, fontWeight:'800' }}>×</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            ))
                          )}
                        </View>
                      );
                    })}
                  </View>
                );
              }}
            />

            {/* FAB Guardar (configurar) */}
            <TouchableOpacity
              onPress={saveAll}
              style={[fabBase, getFabStyle(insets), fabOverNavBar, !(dirtyCoaches || dirtySchedule) && { opacity: 0.6 }]}
              activeOpacity={0.9}
              disabled={!(dirtyCoaches || dirtySchedule)}
            >
              <Text style={{ color:'#fff', fontWeight:'800' }}>Guardar</Text>
            </TouchableOpacity>
          </>
        )}
      </KeyboardAvoidingView>

      {/* Franja inferior azul EXACTA al área de botones del sistema */}
      <View
        pointerEvents="none"
        style={{ position:'absolute', left:0, right:0, bottom:0, height: insets.bottom, backgroundColor: NAVY }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  switcher3: {
    backgroundColor:'#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection:'row',
    padding: 4,
  },
  switchBtn3: { flex:1, paddingVertical: 10, borderRadius: 8, alignItems:'center' },
  switchBtnActive: { backgroundColor: RED },
  switchTxt: { color: NAVY, fontWeight:'700' },
  switchTxtActive: { color:'#fff', fontWeight:'800' },

  lockBar: {
    marginTop: 10,
    flexDirection:'row',
    alignItems:'center',
    backgroundColor:'#fff',
    borderWidth:1,
    borderColor: BORDER,
    borderRadius:12,
    paddingHorizontal:12,
    paddingVertical:10,
  },
  lockBtn: { backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },

  card: {
    backgroundColor: WHITE,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  rowCard: { paddingHorizontal: 16, marginTop: 8 },

  title: { color: NAVY, fontWeight: '800', marginBottom: 8 },
  section: { color: NAVY, fontWeight: '700', marginTop: 6, marginBottom: 6 },

  rowBtn: {
    flexDirection:'row',
    alignItems:'center',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: WHITE,
  },
  rowBtnActive: { backgroundColor: '#E6F4EA', borderColor: '#B8E2C8' },
  rowText: { color: NAVY, fontWeight:'700' },
  rowTextActive: { color: GREEN },
  disabledRow: { opacity: 0.55 },

  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: BORDER, backgroundColor: WHITE,
  },
  radioActive: { borderColor: GREEN, backgroundColor: '#E6F4EA' },

  check: {
    width: 18, height: 18, borderRadius: 4,
    borderWidth: 2, borderColor: BORDER, backgroundColor: WHITE,
    alignItems:'center', justifyContent:'center',
  },
  checkOn: { borderColor: GREEN, backgroundColor: '#E6F4EA' },
  checkTick: { width: 10, height: 10, backgroundColor: GREEN, borderRadius: 2 },

  dayBlock: { marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER, paddingTop: 8 },
  dayTitle: { color: NAVY, fontWeight: '800' },

  btnMini: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: WHITE },
  btnMiniText: { color: NAVY, fontWeight: '700', fontSize: 12 },

  rangeRow: { flexDirection:'row', alignItems:'flex-end', marginTop: 8 },
  rangeLabel: { color: NAVY, fontWeight: '700', marginBottom: 6 },
  rangeInput: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 10, height: 44,
    paddingHorizontal: 12, backgroundColor: WHITE, color: NAVY,
  },
  disabledInput: { opacity: 0.55 },

  btnDel: {
    marginLeft: 8, backgroundColor: RED, width: 36, height: 36, borderRadius: 18,
    alignItems:'center', justifyContent:'center',
  },

  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 44,
    paddingHorizontal: 12, backgroundColor: WHITE, color: NAVY, marginTop: 6, marginBottom: 6,
  },

  // Dropdown categorías
  dropdownTrigger: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownText: { color: NAVY, fontWeight: '700', flex: 1, marginRight: 8 },
  dropdownCaret: { color: MUTED, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  dropdownSheet: {
    position: 'absolute',
    right: 16,
    top: 180,
    width: 220,
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  dropdownItem: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  dropdownItemActive: { backgroundColor: '#EDEFF3' },
  dropdownItemText: { color: NAVY, fontWeight: '700' },
  dropdownItemTextActive: { color: NAVY, fontWeight: '800' },
});
