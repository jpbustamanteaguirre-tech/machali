// app/(tabs)/events.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { collection, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';
import { getFabStyle, LIST_PADDING_BOTTOM } from '../../src/theme/layout';

const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';
const GREEN = '#0E7A3E';
const AMBER = '#B85C00';
const MUTED = '#8A98A8';

// ==== Cache keys (versiónadas para cambios de estructura) ====
const K_EVENTS_STATE = 'events_tab_state_v2'; // {meets, participantsMap, updatedAt}

type MeetDoc = {
  id: string;
  name: string;
  date: string;        // ISO YYYY-MM-DD
  dateDisplay: string; // DD/MM/AAAA
  location?: string;
  status?: 'abierto' | 'cerrado';
  qualifying?: boolean; // válida para nacional
  distance?: number;    // 25 | 50 (Piscina)
};

type CacheShape = {
  meets: MeetDoc[];
  participantsMap: Record<string, number>;
  updatedAt?: number;
};

function norm(s?: string) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const QualBadge = ({ qualifying }: { qualifying?: boolean }) => {
  if (!qualifying) return null;
  return (
    <View style={{ backgroundColor: '#E6F4EA', borderColor: '#B8E2C8', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
      <Text style={{ color: GREEN, fontWeight: '700', fontSize: 12 }}>Válida</Text>
    </View>
  );
};

export default function EventsTab() {
  const { profile } = useAuth();
  const canCreate = profile?.role === 'admin' || profile?.role === 'coach';
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [meets, setMeets] = useState<MeetDoc[]>([]);
  const [participantsMap, setParticipantsMap] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [showValidOnly, setShowValidOnly] = useState(false);

  const resultUnsubs = useRef<Record<string, () => void>>({});

  // —— Hidratar desde caché inmediatamente (si existe) —— //
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(K_EVENTS_STATE);
        if (raw) {
          const parsed = JSON.parse(raw) as CacheShape;
          if (Array.isArray(parsed.meets)) setMeets(parsed.meets);
          if (parsed.participantsMap && typeof parsed.participantsMap === 'object') {
            setParticipantsMap(parsed.participantsMap);
          }
          // mostramos algo rápido mientras llega la red
          setLoading(false);
          setLoadError(null);
        }
      } catch {
        // ignorar errores de lectura
      }
    })();
  }, []);

  // —— Suscripción online + persistencia a caché —— //
  useEffect(() => {
    let unsubMeets: undefined | (() => void);
    const qy = query(collection(db, 'events'), orderBy('date', 'desc')); // ← MEETS

    unsubMeets = onSnapshot(
      qy,
      (snap) => {
        const arr: MeetDoc[] = [];
        const seenIds: string[] = [];
        snap.forEach((d) => {
          const ev = { id: d.id, ...(d.data() as any) } as MeetDoc;
          arr.push(ev);
          seenIds.push(ev.id);
        });
        setMeets(arr);
        setLoading(false);
        setLoadError(null);

        // limpiar suscripciones viejas
        Object.keys(resultUnsubs.current).forEach((evId) => {
          if (!seenIds.includes(evId)) {
            resultUnsubs.current[evId]?.();
            delete resultUnsubs.current[evId];
          }
        });

        // suscribirse a participantes únicos por evento (results.eventId)
        seenIds.forEach((evId) => {
          if (resultUnsubs.current[evId]) return;
          try {
            const qRes = query(collection(db, 'results'), where('eventId', '==', evId));
            resultUnsubs.current[evId] = onSnapshot(
              qRes,
              (snapRes) => {
                const setUnique = new Set<string>();
                snapRes.forEach((r) => {
                  const data = r.data() as any;
                  if (data.athleteId) setUnique.add(String(data.athleteId));
                });
                setParticipantsMap((prev) => {
                  const next = { ...prev, [evId]: setUnique.size };
                  // persistimos caché de forma incremental
                  persistEventsCache(arr, next);
                  return next;
                });
              },
              () => {
                setParticipantsMap((prev) => {
                  const next = { ...prev, [evId]: 0 };
                  persistEventsCache(arr, next);
                  return next;
                });
              }
            );
          } catch {
            setParticipantsMap((prev) => {
              const next = { ...prev, [evId]: 0 };
              persistEventsCache(arr, next);
              return next;
            });
          }
        });

        // Persistimos el listado aunque no haya terminado de llegar cada conteo
        persistEventsCache(arr, participantsMap);
      },
      async () => {
        // Si falla la suscripción, intentamos una lectura puntual
        setLoadError('No se pudieron cargar competencias (permisos o conexión).');
        try {
          const snap = await getDocs(qy);
          const arr: MeetDoc[] = [];
          snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) } as MeetDoc));
          setMeets(arr);
          // persistimos aunque sea el fetch puntual
          persistEventsCache(arr, participantsMap);
        } finally {
          setLoading(false);
        }
      }
    );

    return () => {
      unsubMeets?.();
      Object.values(resultUnsubs.current).forEach((fn) => fn?.());
      resultUnsubs.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // montado 1 vez

  const filtered = useMemo(() => {
    const q = norm(search);
    return meets.filter((e) => {
      if (showValidOnly && !e.qualifying) return false;
      if (!q) return true;
      return norm(e.name).includes(q) || norm(e.location).includes(q);
    });
  }, [meets, search, showValidOnly]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right']}>
      {/* Header: mismo alto y botón de menú transparente para mantener métrica */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
        <View style={styles.headerRow}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Eventos</Text>
          <TouchableOpacity disabled activeOpacity={1} style={{ opacity: 0 }}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerDivider} />
      </SafeAreaView>

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <>
          {/* Buscador + Filtro (1/4) */}
          <View style={styles.filtersRow}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar evento o lugar"
              placeholderTextColor={MUTED}
              style={[styles.input, { flex: 3 }]}
              returnKeyType="search"
            />
            <View style={{ width: 8 }} />
            <TouchableOpacity
              onPress={() => setShowValidOnly((v) => !v)}
              style={[styles.filterBtn, showValidOnly && styles.filterBtnOn, { flex: 1 }]}
            >
              <Text style={[styles.filterBtnTxt, showValidOnly && styles.filterBtnTxtOn]}>
                {showValidOnly ? 'Válidas' : 'Todas'}
              </Text>
            </TouchableOpacity>
          </View>

          {filtered.length === 0 ? (
            <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding: 24 }}>
              <Text style={{ color: NAVY, marginBottom: 6 }}>
                {loadError ?? 'No hay competencias que coincidan.'}
              </Text>
              {canCreate && (
                <TouchableOpacity onPress={() => router.push('/events/new')}>
                  <Text style={{ backgroundColor: RED, color: '#fff', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, fontWeight: '700' }}>
                    Nueva competencia
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(i) => i.id}
              contentContainerStyle={{ paddingTop: 8, paddingBottom: LIST_PADDING_BOTTOM }}
              renderItem={({ item }) => {
                const count = participantsMap[item.id] ?? 0;
                const borderColor = item.qualifying ? '#B8E2C8' : BORDER;
                const statusTxt = item.status === 'abierto' ? 'Abierto' : 'Cerrado';
                const statusColor = item.status === 'abierto' ? GREEN : AMBER;
                const poolLabel = item.distance ? ` · Piscina ${item.distance} m` : '';

                return (
                  <TouchableOpacity
                    onPress={() => router.push(`/events/${item.id}`)}
                    style={{
                      backgroundColor: '#fff',
                      marginHorizontal: 16,
                      marginTop: 12,
                      borderRadius: 12,
                      padding: 14,
                      borderWidth: 1,
                      borderColor,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: NAVY, fontWeight: '700', flex: 1, paddingRight: 8 }}>
                        {item.name}
                      </Text>
                      <QualBadge qualifying={!!item.qualifying} />
                    </View>
                    <Text style={{ color: '#4A5A6A', marginTop: 4 }}>
                      {item.dateDisplay} · {item.location ?? '—'}{poolLabel}
                    </Text>
                    <View style={{ flexDirection:'row', marginTop: 6, justifyContent:'space-between' }}>
                      <Text style={{ color: '#8A98A8', fontWeight: '700' }}>{count} participantes</Text>
                      <Text style={{ color: statusColor, fontWeight: '700' }}>
                        {statusTxt}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}

          {canCreate && (
            <TouchableOpacity
              onPress={() => router.push('/events/new')}
              style={[{ backgroundColor: RED, borderRadius: 28, paddingHorizontal: 18, paddingVertical: 14 }, getFabStyle(insets)]}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Nueva</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

/** Persiste el snapshot actual (meets + participants) para uso offline */
async function persistEventsCache(meets: MeetDoc[], participantsMap: Record<string, number>) {
  try {
    const payload: CacheShape = {
      meets,
      participantsMap,
      updatedAt: Date.now(),
    };
    await AsyncStorage.setItem(K_EVENTS_STATE, JSON.stringify(payload));
  } catch {
    // ignorar errores de escritura
  }
}

const styles = StyleSheet.create({
  headerRow: {
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    includeFontPadding: false as any,
  },
  menuIcon: { color: '#fff', fontSize: 22, fontWeight: '800', includeFontPadding: false as any },
  headerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 },

  filtersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    color: NAVY,
    fontWeight: '700',
  },
  filterBtn: {
    height: 44,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  filterBtnOn: {
    backgroundColor: '#E6F4EA',
    borderColor: '#B8E2C8',
  },
  filterBtnTxt: { color: NAVY, fontWeight: '700' },
  filterBtnTxtOn: { color: GREEN, fontWeight: '800' },
});
