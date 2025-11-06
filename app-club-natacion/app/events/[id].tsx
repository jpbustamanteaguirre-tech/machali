// app/events/[id].tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as NavigationBar from 'expo-navigation-bar';
import { router, useLocalSearchParams } from 'expo-router';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import { useAuth } from '../../src/stores/authStore';

const BG = '#F7F8FA';
const NAVY = '#0B1E2F';
const BORDER = '#E6E8EC';
const RED = '#CE2434';
const MUTED = '#8A98A8';

type EventDoc = {
  name: string;
  date?: string;         // ISO YYYY-MM-DD
  dateDisplay?: string;  // DD/MM/AAAA
  location?: string;
  qualifying?: boolean;
  status?: 'abierto' | 'cerrado';
  createdBy?: string;
  distance?: number | null; // 25 / 50 (m)
};

const toTitleCase = (s: string) =>
  (s || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');

function isoToDisplay(iso?: string) {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '—';
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

export default function EventDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'coach';

  // === Keys de caché por evento ===
  const EVENT_CACHE_KEY = id ? `event_${id}_v1` : 'event__noid';
  const PARTS_CACHE_KEY = id ? `event_${id}_participants_v1` : 'event__noid_participants';

  const [eventData, setEventData] = useState<EventDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [participants, setParticipants] = useState<number>(0);

  // Altura real del header para anclar la hoja de menú
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = (e: LayoutChangeEvent) => setHeaderHeight(e.nativeEvent.layout.height);

  // Android nav bar (consistencia pantallas secundarias)
  useEffect(() => {
    NavigationBar.setBackgroundColorAsync(NAVY);
    NavigationBar.setButtonStyleAsync('light');
    NavigationBar.setVisibilityAsync('visible');
  }, []);

  // === Arranque OFFLINE desde caché (evento + participantes) ===
  useEffect(() => {
    (async () => {
      try {
        const rawEv = await AsyncStorage.getItem(EVENT_CACHE_KEY);
        if (rawEv) {
          const cached = JSON.parse(rawEv) as EventDoc | null;
          if (cached) setEventData(cached);
        }
      } catch {}
      try {
        const rawP = await AsyncStorage.getItem(PARTS_CACHE_KEY);
        if (rawP) {
          const cachedN = Number(JSON.parse(rawP));
          if (Number.isFinite(cachedN)) setParticipants(cachedN);
        }
      } catch {}
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // === Snapshot del evento + persistencia ===
  useEffect(() => {
    if (!id) return;
    const ref = doc(db, 'events', String(id));
    // mantenemos loading solo si aún no tenemos eventData
    setLoading((prev) => prev && true);

    const unsub = onSnapshot(
      ref,
      async (snap) => {
        if (!snap.exists()) {
          Alert.alert('Ups', 'Evento no encontrado');
          router.back();
          return;
        }
        const raw = snap.data() as any;

        let distance: number | null = null;
        if (raw?.distance !== undefined && raw?.distance !== null) {
          const n = Number(raw.distance);
          distance = Number.isFinite(n) ? n : null;
        }

        const ev: EventDoc = {
          name: toTitleCase(raw.name || 'Evento'),
          date: raw.date,
          dateDisplay: raw.dateDisplay,
          location: raw.location,
          qualifying: !!raw.qualifying,
          status: (raw.status as any) || 'abierto',
          createdBy: raw.createdBy,
          distance,
        };

        setEventData(ev);
        try { await AsyncStorage.setItem(EVENT_CACHE_KEY, JSON.stringify(ev)); } catch {}
        setLoading(false);
      },
      () => setLoading(false)
    );

    return unsub;
  }, [id]);

  // === Participantes únicos (online) + persistencia del conteo ===
  useEffect(() => {
    if (!id) return;
    const qy = query(collection(db, 'results'), where('eventId', '==', String(id)));
    const unsub = onSnapshot(qy, async (snap) => {
      const setIds = new Set<string>();
      snap.forEach((d) => {
        const r = d.data() as any;
        if (r.athleteId) setIds.add(String(r.athleteId));
      });
      const n = setIds.size;
      setParticipants(n);
      try { await AsyncStorage.setItem(PARTS_CACHE_KEY, JSON.stringify(n)); } catch {}
    });
    return unsub;
  }, [id]);

  const dateDisplay = useMemo(
    () => eventData?.dateDisplay ?? isoToDisplay(eventData?.date),
    [eventData?.dateDisplay, eventData?.date]
  );

  const statusBadge = useMemo(() => {
    const st =
      eventData?.status === 'cerrado'
        ? { bg: '#FDECEA', br: '#F7D2CD', txt: '#B00020', label: 'Cerrado' }
        : { bg: '#E6F4EA', br: '#B8E2C8', txt: '#0E7A3E', label: 'Abierto' };
    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: st.br,
          backgroundColor: st.bg,
          borderRadius: 10,
          paddingHorizontal: 8,
          paddingVertical: 4,
          alignSelf: 'flex-start',
        }}
      >
        <Text style={{ color: st.txt, fontWeight: '800' }}>{st.label}</Text>
      </View>
    );
  }, [eventData?.status]);

  // Acciones
  const toggleInscripcion = async () => {
    try {
      if (!id || !eventData) return;
      const next = eventData.status === 'abierto' ? 'cerrado' : 'abierto';
      await updateDoc(doc(db, 'events', String(id)), { status: next });
      // Actualizamos local e inmediatamente persistimos la caché
      const nextEv = { ...eventData, status: next } as EventDoc;
      setEventData(nextEv);
      try { await AsyncStorage.setItem(EVENT_CACHE_KEY, JSON.stringify(nextEv)); } catch {}
      Alert.alert('Listo', `Inscripción ${next === 'abierto' ? 'abierta' : 'cerrada'}.`);
    } catch {
      Alert.alert('Error', 'No se pudo actualizar el estado');
    } finally {
      setMenuOpen(false);
    }
  };

  const irAEditar = () => {
    setMenuOpen(false);
    router.push(`/events/${id}/edit`);
  };

  const cargarTiempos = () => {
    if (!id) return;
    router.push(`/times/new?eventId=${id}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      {/* Header azul estándar */}
      <SafeAreaView
        edges={['top', 'left', 'right']}
        style={{ backgroundColor: NAVY }}
        onLayout={onHeaderLayout}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>
            {eventData?.name ?? 'Evento'}
          </Text>
          <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {/* Contenido */}
      {loading && !eventData ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: NAVY }}>Cargando…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: Math.max(8, insets.bottom) }}>
          <View style={styles.card}>
            <Text style={styles.label}>Fecha</Text>
            <Text style={styles.value}>{dateDisplay}</Text>

            <Text style={[styles.label, { marginTop: 6 }]}>Lugar</Text>
            <Text style={styles.value}>{eventData?.location || '—'}</Text>

            {/* Piscina (distancia) */}
            <Text style={[styles.label, { marginTop: 6 }]}>Piscina</Text>
            <Text style={styles.value}>
              {eventData?.distance ? `${eventData.distance} m` : '—'}
            </Text>

            <Text style={[styles.label, { marginTop: 6 }]}>Válida</Text>
            <Text style={styles.value}>{eventData?.qualifying ? 'Sí' : 'No'}</Text>

            <Text style={[styles.label, { marginTop: 6 }]}>Estado</Text>
            <View style={{ marginTop: 4 }}>{statusBadge}</View>

            <Text style={[styles.label, { marginTop: 6 }]}>Participantes (únicos)</Text>
            <Text style={styles.value}>{participants}</Text>
          </View>
        </ScrollView>
      )}

      {/* FAB */}
      {canEdit && (
        <TouchableOpacity
          onPress={cargarTiempos}
          activeOpacity={0.9}
          style={[
            styles.fab,
            { right: 16, bottom: Math.max(16, insets.bottom + 12), zIndex: 10, elevation: 10 },
          ]}
        >
          <Text style={styles.fabTxt}>Cargar tiempos</Text>
        </TouchableOpacity>
      )}

      {/* Menú acciones anclado */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)} />
        <View style={[styles.menuSheet, { top: headerHeight || 64 }]}>
          <Text style={styles.menuTitle}>Acciones</Text>

          {canEdit && (
            <TouchableOpacity style={styles.menuItem} onPress={irAEditar}>
              <Text style={styles.menuItemText}>Editar evento</Text>
            </TouchableOpacity>
          )}

          {canEdit && (
            <TouchableOpacity style={styles.menuItem} onPress={toggleInscripcion}>
              <Text style={styles.menuItemText}>
                {eventData?.status === 'abierto' ? 'Cerrar inscripción' : 'Abrir inscripción'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={() => setMenuOpen(false)} style={{ marginTop: 10 }}>
            <Text style={styles.menuCancel}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Overlay inferior NAVY */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: insets.bottom,
          backgroundColor: NAVY,
        }}
      />
    </SafeAreaView>
  );
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
    flex: 1,
    paddingHorizontal: 12,
    includeFontPadding: false as any,
  },
  backText: { color: '#fff', fontSize: 18, includeFontPadding: false as any },
  menuIcon: { color: '#fff', fontSize: 22, fontWeight: '800', includeFontPadding: false as any },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  label: { color: MUTED, fontWeight: '700' },
  value: { color: NAVY, fontWeight: '800', marginTop: 2 },

  // FAB
  fab: {
    position: 'absolute',
    backgroundColor: RED,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  fabTxt: { color: '#fff', fontWeight: '700' },

  // Menú modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  menuSheet: {
    position: 'absolute',
    right: 12,
    width: 260,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  menuTitle: { color: '#0B1E2F', fontWeight: '800', marginBottom: 8 },
  menuItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  menuItemText: { color: '#0B1E2F', fontWeight: '700' },
  menuCancel: {
    color: '#0B1E2F',
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
});
