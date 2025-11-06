// app/events/new.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';
import { displayDateToISO, maskDateDigitsToDisplay } from '../../src/utils/format';

const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';

const DRAFT_KEY = 'event_new_draft_v1';

type Draft = {
  name: string;
  location: string;
  dateDisplay: string;     // DD/MM/AAAA
  isQualifying: boolean;
  distance: number | null; // 25 | 50 | null
};

export default function EventNew() {
  const insets = useSafeAreaInsets(); // franja inferior
  const { profile } = useAuth();
  const canCreate = profile?.role === 'admin' || profile?.role === 'coach';

  if (!canCreate) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right','bottom']}>
        {/* Header azul */}
        <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Nuevo Evento</Text>
          </View>
        </SafeAreaView>

        <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding: 24 }}>
          <Text style={{ color: NAVY }}>No tienes permiso para crear eventos.</Text>
        </View>

        {/* Franja inferior NAVY */}
        <View
          pointerEvents="none"
          style={{ position:'absolute', left:0, right:0, bottom:0, height: insets.bottom, backgroundColor: NAVY }}
        />
      </SafeAreaView>
    );
  }

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [dateDisplay, setDateDisplay] = useState(''); // DD/MM/AAAA
  const [isQualifying, setIsQualifying] = useState(false);
  const [distance, setDistance] = useState<number | null>(null); // 25 | 50
  const [errors, setErrors] = useState<Record<string,string>>({});

  // ====== Restaurar borrador al entrar ======
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw) as Draft;
        if (typeof d?.name === 'string') setName(d.name);
        if (typeof d?.location === 'string') setLocation(d.location);
        if (typeof d?.dateDisplay === 'string') setDateDisplay(d.dateDisplay);
        if (typeof d?.isQualifying === 'boolean') setIsQualifying(d.isQualifying);
        if (d?.distance === 25 || d?.distance === 50) setDistance(d.distance);
      } catch {
        // ignora errores de parseo
      }
    })();
  }, []);

  // ====== Guardado automático del borrador (debounce) ======
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = (next: Draft) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(next)).catch(() => {});
    }, 300);
  };

  // Guarda borrador cuando cambie cualquier campo
  useEffect(() => {
    scheduleSave({ name, location, dateDisplay, isQualifying, distance });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, location, dateDisplay, isQualifying, distance]);

  const submit = async () => {
    const errs: Record<string,string> = {};
    if (!name.trim()) errs.name = 'Requerido';

    const iso = displayDateToISO(dateDisplay);
    if (!iso) errs.date = 'Fecha inválida (DD/MM/AAAA)';

    if (distance !== 25 && distance !== 50) {
      errs.distance = 'Selecciona 25 o 50';
    }

    setErrors(errs);
    if (Object.keys(errs).length) return;

    const payload = {
      name: name.trim(),
      location: location.trim(),
      date: iso!,
      dateDisplay,
      status: 'abierto' as const,
      qualifying: isQualifying,
      distance,             // legacy (compatibilidad)
      poolLength: distance, // clave que usa el resto de la app
      createdAt: serverTimestamp(),
    };

    try {
      const ref = await addDoc(collection(db, 'events'), payload);
      // Limpia borrador solo si se creó correctamente
      await AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
      Alert.alert('Listo', 'Evento creado');
      router.push(`/events/${ref.id}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo crear el evento');
    }
  };

  const kbBehavior = Platform.OS === 'ios' ? 'padding' : 'height';
  const kbOffset = Platform.OS === 'ios' ? 0 : 56;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right','bottom']}>
      {/* Header azul */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Nuevo Evento</Text>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={kbBehavior} keyboardVerticalOffset={kbOffset}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Nombre del evento</Text>
          <TextInput
            value={name}
            onChangeText={(t) => setName(t)}
            placeholder="Copa Primavera"
            placeholderTextColor="#8A98A8"
            style={styles.input}
          />
          {!!errors.name && <Text style={styles.error}>{errors.name}</Text>}

          <Text style={styles.label}>Fecha</Text>
          <TextInput
            value={dateDisplay}
            onChangeText={(t) => setDateDisplay(maskDateDigitsToDisplay(t ?? ''))}
            keyboardType="number-pad"
            placeholder="DD/MM/AAAA"
            placeholderTextColor="#8A98A8"
            style={styles.input}
          />
          {!!errors.date && <Text style={styles.error}>{errors.date}</Text>}

          <Text style={styles.label}>Lugar</Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="Piscina Municipal"
            placeholderTextColor="#8A98A8"
            style={styles.input}
          />

          {/* Selector de Piscina (metros) */}
          <Text style={styles.label}>Piscina (metros)</Text>
          <View style={styles.chipsRow}>
            {[25, 50].map((v) => {
              const active = distance === v;
              return (
                <TouchableOpacity
                  key={v}
                  onPress={() => setDistance(v)}
                  activeOpacity={0.9}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{v} m</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {!!errors.distance && <Text style={styles.error}>{errors.distance}</Text>}

          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop: 16, paddingVertical: 6 }}>
            <Text style={{ color: NAVY, fontWeight: '600' }}>¿Válida para Nacional?</Text>
            <Switch value={isQualifying} onValueChange={setIsQualifying} />
          </View>

          <TouchableOpacity onPress={submit} style={{ marginTop: 20 }}>
            <Text style={styles.btn}>Guardar</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Franja inferior NAVY */}
      <View
        pointerEvents="none"
        style={{ position:'absolute', left:0, right:0, bottom:0, height: insets.bottom, backgroundColor: NAVY }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  label: { color: NAVY, fontWeight: '600', marginTop: 10 },
  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 48,
    paddingHorizontal: 14, color: NAVY, backgroundColor: '#fff', marginTop: 6,
  },
  error: { color: RED, marginTop: 6 },

  // Chips selector
  chipsRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  chip: {
    borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff',
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8,
  },
  chipActive: { backgroundColor: '#EDEFF3', borderColor: '#D5DAE1' },
  chipTxt: { color: NAVY, fontWeight: '700' },
  chipTxtActive: { color: NAVY, fontWeight: '800' },

  btn: {
    backgroundColor: RED, color: '#fff', textAlign: 'center',
    paddingVertical: 14, borderRadius: 24, fontWeight: '700'
  },
});
