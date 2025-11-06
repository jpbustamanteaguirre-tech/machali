// app/(tabs)/index.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TitleBar from '../../src/components/TitleBar';

const NAVY = '#0B1E2F';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';

// === Cache keys ===
const K_HOME_STATE = 'home_tab_state_v1';

type HomeState = {
  lastVisitAt?: number; // epoch ms
  version?: number;     // por si ajustamos estructura
};

// Estado por defecto
const DEFAULT_HOME_STATE: HomeState = {
  lastVisitAt: undefined,
  version: 1,
};

export default function HomeTab() {
  // Estado local (hidratado desde caché)
  const [homeState, setHomeState] = useState<HomeState>(DEFAULT_HOME_STATE);

  // Ref para evitar múltiples escrituras inmediatas
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hidrata desde AsyncStorage al montar
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(K_HOME_STATE);
        if (raw) {
          const parsed = JSON.parse(raw) as HomeState;
          setHomeState({ ...DEFAULT_HOME_STATE, ...parsed });
        }
      } catch {
        // ignora errores de lectura
      }
      // Actualiza "lastVisitAt" y persiste en background
      const next: HomeState = { version: 1, lastVisitAt: Date.now() };
      setHomeState(prev => ({ ...prev, ...next }));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        AsyncStorage.setItem(K_HOME_STATE, JSON.stringify({ ...next })).catch(() => {});
      }, 200);
    })();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Header azul unificado del proyecto */}
      <TitleBar title="Inicio" />

      {/* Contenido (sin SafeArea top; respetamos bottom/left/right) */}
      <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container}>
          {/* Badge beta */}
          <View style={styles.betaBadge}>
            <Text style={styles.betaTxt}>Beta · En desarrollo</Text>
          </View>

          {/* Bienvenida */}
          <Text style={styles.h1}>¡Bienvenido al Club de Natación!</Text>
          <Text style={styles.p}>
            Esta aplicación te ayuda a gestionar deportistas, asistencia, eventos e históricos de tiempos,
            todo en tiempo real y con permisos por rol.
          </Text>

          {/* Funciones principales */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Funciones principales</Text>
            <Text style={styles.item}>• Tomar asistencia y justificar ausencias por grupo.</Text>
            <Text style={styles.item}>• Crear y revisar eventos e inscripciones.</Text>
            <Text style={styles.item}>• Ver y cargar tiempos por deportista o competencia.</Text>
            <Text style={styles.item}>• Editar datos básicos según tu rol (admin/coach/athlete/guardian).</Text>
          </View>

          {/* Info de estado local (lastVisit) */}
          {homeState.lastVisitAt ? (
            <Text style={[styles.p, { marginTop: 6 }]}>
              Última visita a Inicio: {new Date(homeState.lastVisitAt).toLocaleString()}
            </Text>
          ) : null}

          <Text style={[styles.p, { marginTop: 10 }]}>
            Usa las pestañas inferiores para navegar. El contenido se actualiza automáticamente en todos los dispositivos.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10 },
  h1: { color: NAVY, fontSize: 16, fontWeight: '800' },
  p: { color: '#4A5A6A' },
  betaBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1, borderColor: '#F7D2CD',
    backgroundColor: '#FDECEA',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4,
  },
  betaTxt: { color: '#B00020', fontWeight: '800', fontSize: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  cardTitle: { color: NAVY, fontWeight: '800', marginBottom: 6 },
  item: { color: '#4A5A6A', marginTop: 4 },
});
