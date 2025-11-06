// app/(tabs)/times.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';

const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BG = '#F7F8FA';

// === Cache key ===
const K_RESULTS = 'times_tab_results_v1';

// Helpers
const toTitleCase = (s: string) =>
  (s || '').toLowerCase().split(' ').filter(Boolean).map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');

type Result = {
  id: string;
  athleteId: string;
  athleteName: string;
  style: string;
  distance: number;
  origin: 'Entrenamiento' | 'Torneo' | 'Personal';
  dateDisplay: string;
  timeMs: number;
  timeStr: string;
  isPersonal?: boolean;
};

export default function TimesTab() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const role = profile?.role;
  const canCreate = role === 'admin' || role === 'coach' || role === 'athlete';

  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Result[]>([]);

  // ---- Debounced persist ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = (value: any) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(K_RESULTS, JSON.stringify(value)).catch(() => {});
    }, 300);
  };

  // ---- Hydrate from cache first (offline-first) ----
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(K_RESULTS);
        if (cached) {
          const parsed: Result[] = JSON.parse(cached);
          setResults(parsed);
        }
      } finally {
        // Mostramos algo aunque no haya red
        setLoading(false);
      }
    })();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // ---- Live subscription (then persist to cache) ----
  useEffect(() => {
    const qy = query(collection(db, 'results'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr: Result[] = [];
        snap.forEach(doc => arr.push({ id: doc.id, ...(doc.data() as any) }));
        setResults(arr);
        debouncedSave(arr);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const data = useMemo(() => results, [results]);

  const Fab = () => {
    if (!canCreate) return null;
    const bottom = 24 + Math.max(insets.bottom, 8); // despegar de la tab bar
    return (
      <TouchableOpacity
        onPress={() => router.push('/times/new')}
        style={{
          position: 'absolute',
          right: 20,
          bottom,
          backgroundColor: RED,
          borderRadius: 28,
          paddingHorizontal: 20,
          paddingVertical: 14,
          zIndex: 50,
          ...(Platform.OS === 'android'
            ? { elevation: 6 }
            : { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }),
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '700' }}>Nuevo</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right','bottom']}>
      {/* Barra azul con título (misma medida que Events) */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Tiempos</Text>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      ) : data.length === 0 ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding: 24 }}>
          <Text style={{ color: NAVY, marginBottom: 12 }}>Aún no hay tiempos</Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 120 /* espacio para que no tape el FAB */ }}
          renderItem={({ item }) => (
            <View style={{ backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 14 }}>
              <Text style={{ color: NAVY, fontWeight: '700' }}>
                {toTitleCase(item.athleteName)} · {item.distance}m {item.style}
              </Text>
              <Text style={{ color: '#4A5A6A', marginTop: 4 }}>{item.dateDisplay} · {item.origin}</Text>
              <Text style={{ color: '#8A98A8', marginTop: 2, fontWeight: '700' }}>{item.timeStr}</Text>
            </View>
          )}
        />
      )}

      {/* FAB siempre visible por encima de la tab bar */}
      <Fab />
    </SafeAreaView>
  );
}
