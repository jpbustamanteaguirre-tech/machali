// app/athletes/new.tsx
import { router } from 'expo-router';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import {
  displayDateToISO,
  formatRutDisplay,
  maskDateDigitsToDisplay,
  normalizeRutToSave,
  validateRut,
} from '../../src/utils/format';

const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';

const toTitleCase = (s: string) =>
  (s || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export default function AthleteNew() {
  const { profile } = useAuth();
  const canCreate = profile?.role === 'admin' || profile?.role === 'coach';
  const insets = useSafeAreaInsets();

  const rutRef = useRef<TextInput>(null);
  const birthRef = useRef<TextInput>(null);

  const [name, setName] = useState('');
  const [birthDisplay, setBirthDisplay] = useState('');

  // === RUT con anti-rebote y cursor controlado (idéntico a login) ===
  const [rutRaw, setRutRaw] = useState('');
  const [rutDisplay, setRutDisplay] = useState('');
  const prevRawRef = useRef('');
  const [rutSelection, setRutSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  const [gender, setGender] = useState<'Masculino' | 'Femenino' | ''>('');
  const [errors, setErrors] = useState<{ [k: string]: string }>({});

  const submit = async () => {
    const errs: any = {};
    if (!name.trim()) errs.name = 'Requerido';
    const birthISO = displayDateToISO(birthDisplay);
    if (!birthISO) errs.birth = 'Fecha inválida (DD/MM/AAAA)';
    if (!validateRut(rutDisplay)) errs.rut = 'RUT inválido';
    if (!gender) errs.gender = 'Selecciona género';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const y = new Date().getFullYear();
    const payload = {
      name: toTitleCase(name.trim()),
      birth: birthISO,
      birthDisplay,
      rut: normalizeRutToSave(rutDisplay),
      rutDisplay,
      gender,
      seasonYear: y,
      ageOnJan1: 0,
      category: '-',
      status: 'pending',
      createdAt: serverTimestamp(),
    };

    try {
      const ref = await addDoc(collection(db, 'athletes'), payload);
      Alert.alert('Listo', 'Nadador creado');
      router.replace(`/athletes/${ref.id}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo crear');
    }
  };

  const kbBehavior = Platform.OS === 'ios' ? 'padding' : 'height';
  const kbOffset = Platform.OS === 'ios' ? 0 : 56;

  const TitleBar = (
    <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
      <View
        style={{
          backgroundColor: NAVY,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ color: '#fff', fontSize: 18 }}>←</Text>
        </TouchableOpacity>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: '#fff', fontSize: 18, fontWeight: '700', flex: 1, paddingHorizontal: 12 }}
        >
          Nuevo Nadador
        </Text>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', opacity: 0 }}>☰</Text>
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
    </SafeAreaView>
  );

  if (!canCreate) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right','bottom']}>
        {TitleBar}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: NAVY, textAlign: 'center' }}>
            No tienes permiso para crear nadadores.
          </Text>
        </View>
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom, backgroundColor: NAVY }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right','bottom']}>
      {TitleBar}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={kbBehavior} keyboardVerticalOffset={kbOffset}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Nombre</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            placeholder="Juan Bustamante"
            placeholderTextColor="#8A98A8"
            style={styles.input}
          />
          {!!errors.name && <Text style={styles.error}>{errors.name}</Text>}

          <Text style={styles.label}>RUT</Text>
          <TextInput
            value={rutDisplay}
            onChange={(e: any) => {
              const t = String(e?.nativeEvent?.text ?? '');
              const raw = t.replace(/[^\dKk]/g, '').toUpperCase();
              if (raw === prevRawRef.current) return;
              prevRawRef.current = raw;

              const nextDisplay = raw.length <= 1 ? raw : formatRutDisplay(raw);
              setRutRaw(raw);
              setRutDisplay(nextDisplay);

              const pos = nextDisplay.length;
              requestAnimationFrame(() => setRutSelection({ start: pos, end: pos }));
            }}
            selection={rutSelection}
            keyboardType="default"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            // @ts-ignore
            importantForAutofill="no"
            maxLength={12}
            returnKeyType="next"
            onSubmitEditing={() => birthRef.current?.focus()}
            ref={rutRef}
            placeholder="11.111.111-1"
            placeholderTextColor="#8A98A8"
            style={styles.input}
          />
          {!!errors.rut && <Text style={styles.error}>{errors.rut}</Text>}

          <Text style={styles.label}>Fecha de nacimiento</Text>
          <TextInput
            value={birthDisplay}
            onChangeText={(t) => setBirthDisplay(maskDateDigitsToDisplay(t))}
            keyboardType="number-pad"
            ref={birthRef}
            placeholder="DD/MM/AAAA"
            placeholderTextColor="#8A98A8"
            style={styles.input}
          />
          {!!errors.birth && <Text style={styles.error}>{errors.birth}</Text>}

          <Text style={[styles.label, { marginTop: 8 }]}>Género</Text>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <TouchableOpacity onPress={() => setGender('Masculino')} style={[styles.chip, gender === 'Masculino' && styles.chipActive]}>
              <Text style={[styles.chipText, gender === 'Masculino' && styles.chipTextActive]}>Masculino</Text>
            </TouchableOpacity>
            <View style={{ width: 8 }} />
            <TouchableOpacity onPress={() => setGender('Femenino')} style={[styles.chip, gender === 'Femenino' && styles.chipActive]}>
              <Text style={[styles.chipText, gender === 'Femenino' && styles.chipTextActive]}>Femenino</Text>
            </TouchableOpacity>
          </View>
          {!!errors.gender && <Text style={styles.error}>{errors.gender}</Text>}

          <TouchableOpacity onPress={submit} style={{ marginTop: 20 }}>
            <Text style={styles.btn}>Guardar</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom, backgroundColor: NAVY }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  label: { color: NAVY, fontWeight: '600', marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 48,
    paddingHorizontal: 14, color: NAVY, backgroundColor: '#fff', marginTop: 6,
  },
  error: { color: '#CE2434', marginTop: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    backgroundColor: '#EDEFF3',
  },
  chipActive: { backgroundColor: RED },
  chipText: { color: NAVY, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  btn: {
    backgroundColor: RED, color: '#fff', textAlign: 'center', paddingVertical: 14,
    borderRadius: 24, fontWeight: '700',
  },
});
