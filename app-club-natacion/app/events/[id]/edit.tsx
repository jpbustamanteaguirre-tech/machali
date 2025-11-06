// app/events/[id]/edit.tsx
import * as NavigationBar from 'expo-navigation-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../../src/services/firebase';
import { useAuth } from '../../../src/stores/authStore';
import { displayDateToISO, maskDateDigitsToDisplay } from '../../../src/utils/format';

const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';
const MUTED = '#8A98A8';

type EventDoc = {
  name: string;
  date?: string;         // ISO YYYY-MM-DD
  dateDisplay?: string;  // DD/MM/AAAA
  location?: string;
  qualifying?: boolean;  // válida para Nacional
  status?: 'abierto' | 'cerrado';
};

const toTitleCase = (s: string) =>
  (s || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');

export default function EventEdit() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'coach';

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [dateDisplay, setDateDisplay] = useState(''); // DD/MM/AAAA
  const [qualifying, setQualifying] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Android nav bar en NAVY (consistencia pantallas secundarias)
  useEffect(() => {
    NavigationBar.setBackgroundColorAsync(NAVY);
    NavigationBar.setButtonStyleAsync('light');
    NavigationBar.setVisibilityAsync('visible');
  }, []);

  // Cargar datos actuales del evento
  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        const snap = await getDoc(doc(db, 'events', String(id)));
        if (!snap.exists()) {
          Alert.alert('Ups', 'Evento no encontrado');
          router.back();
          return;
        }
        const raw = snap.data() as any as EventDoc;
        setName(toTitleCase(raw.name || ''));
        setLocation(raw.location || '');
        setDateDisplay(raw.dateDisplay || '');
        setQualifying(!!raw.qualifying);
      } catch {
        Alert.alert('Error', 'No se pudo cargar el evento');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (!canEdit) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
        {/* Header unificado */}
        <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: NAVY }}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.backText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Editar evento</Text>
            {/* placeholder para mantener altura (no se usa) */}
            <Text style={styles.menuIcon} accessibilityElementsHidden importantForAccessibility="no">
              &nbsp;
            </Text>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
        </SafeAreaView>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: NAVY }}>No tienes permiso para editar eventos.</Text>
        </View>

        {/* Overlay inferior exacto al inset del sistema */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom, backgroundColor: NAVY }}
        />
      </SafeAreaView>
    );
  }

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Requerido';
    const iso = displayDateToISO(dateDisplay);
    if (!iso) errs.date = 'Fecha inválida (DD/MM/AAAA)';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    try {
      await updateDoc(doc(db, 'events', String(id)), {
        name: toTitleCase(name.trim()),
        location: location.trim(),
        date: iso,
        dateDisplay,
        qualifying,
      });
      Alert.alert('Listo', 'Evento actualizado');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo actualizar');
    }
  };

  const kbBehavior = Platform.OS === 'ios' ? 'padding' : 'height';
  const kbOffset = Platform.OS === 'ios' ? 0 : 56;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      {/* Header azul unificado (misma métrica que el resto) */}
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: NAVY }}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Editar evento</Text>
          {/* placeholder para mantener altura idéntica (sin menú real) */}
          <Text style={styles.menuIcon} accessibilityElementsHidden importantForAccessibility="no">
            &nbsp;
          </Text>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: NAVY }}>Cargando…</Text>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={kbBehavior} keyboardVerticalOffset={kbOffset}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingBottom: Math.max(8, insets.bottom) }}
          >
            <Text style={styles.label}>Nombre del evento</Text>
            <TextInput
              value={name}
              onChangeText={(t) => setName(toTitleCase(t))}
              placeholder="Copa Primavera"
              placeholderTextColor={MUTED}
              style={styles.input}
            />
            {!!errors.name && <Text style={styles.error}>{errors.name}</Text>}

            <Text style={styles.label}>Fecha</Text>
            <TextInput
              value={dateDisplay}
              onChangeText={(t) => setDateDisplay(maskDateDigitsToDisplay(t ?? ''))}
              keyboardType="number-pad"
              placeholder="DD/MM/AAAA"
              placeholderTextColor={MUTED}
              style={styles.input}
            />
            {!!errors.date && <Text style={styles.error}>{errors.date}</Text>}

            <Text style={styles.label}>Lugar</Text>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Piscina Municipal"
              placeholderTextColor={MUTED}
              style={styles.input}
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
              <Text style={{ color: NAVY, fontWeight: '600' }}>¿Válida para Nacional?</Text>
              <Switch value={qualifying} onValueChange={setQualifying} />
            </View>

            <TouchableOpacity onPress={submit} style={{ marginTop: 20 }}>
              <Text style={styles.btn}>Guardar cambios</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Overlay inferior EXACTO al inset del sistema (no añade aire extra) */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom, backgroundColor: NAVY }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Header
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
  // icono “placeholder” invisible para mantener altura
  menuIcon: { color: NAVY, fontSize: 22, fontWeight: '800' },

  // Form
  label: { color: NAVY, fontWeight: '600', marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 14,
    color: NAVY,
    backgroundColor: '#fff',
    marginTop: 6,
  },
  error: { color: RED, marginTop: 6 },
  btn: {
    backgroundColor: RED,
    color: '#fff',
    textAlign: 'center',
    paddingVertical: 14,
    borderRadius: 24,
    fontWeight: '700',
  },
});
