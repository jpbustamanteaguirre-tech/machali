// app/auth/login.tsx
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db, firebaseAuth } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';
import { formatRutDisplay, normalizeRutToSave } from '../../src/utils/format';

const GRADIENT_COLORS = ['#CE2434', '#7E1A27', '#401520', '#0B1E2F'];
const Gradient: any = LinearGradient;
const brandLogoLight = require('../../assets/images/logoblanco.png');

const fmt: any = (() => {
  try { return require('../../src/utils/format'); } catch { return {}; }
})();
function fallbackMaskDateDDMMYYYY(val: string) {
  const digits = (val || '').replace(/\D/g, '').slice(0, 8);
  const d = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  if (digits.length <= 2) return d;
  if (digits.length <= 4) return `${d}/${m}`;
  return `${d}/${m}/${y}`;
}
function fallbackToISOFromDDMMYYYY(val: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(val || '');
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}
const maskDateDDMMYYYY: (s: string) => string =
  typeof fmt.maskDateDDMMYYYY === 'function' ? fmt.maskDateDDMMYYYY : fallbackMaskDateDDMMYYYY;
const toISOFromDDMMYYYY: (s: string) => string | null =
  typeof fmt.toISOFromDDMMYYYY === 'function'
    ? fmt.toISOFromDDMMYYYY
    : (typeof fmt.normalizeDateToISO === 'function'
        ? fmt.normalizeDateToISO
        : fallbackToISOFromDDMMYYYY);

// Helpers de escritura (las usamos en registro; en login evitamos crear athletes)
async function upsertUser(uid: string, payload: any) {
  await setDoc(doc(db, 'users', uid), payload, { merge: true });
}
async function upsertAthlete(athleteId: string, payload: any) {
  await setDoc(doc(db, 'athletes', athleteId), payload, { merge: true });
}

function isApproved(data: any) {
  return data?.approved === true || data?.status === 'active' || data?.status === 'approved';
}

export default function Login() {
  const insets = useSafeAreaInsets();
  const { loginEmail, registerEmail } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');

  // Registro extendido
  const [fullName, setFullName] = useState('');
  const rutRef = useRef<TextInput>(null);
  const prevRawRef = useRef('');
  const [rutRaw, setRutRaw] = useState('');
  const [rutDisplay, setRutDisplay] = useState('');
  const [rutSelection, setRutSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  const [birth, setBirth] = useState('');
  const [isGuardian, setIsGuardian] = useState(false);
  const [athleteName, setAthleteName] = useState('');
  const [notes, setNotes] = useState('');

  // === NAV AUTOMÁTICA por sesión + perfil (sin timers; soporta OFFLINE con caché) ===
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(firebaseAuth, (u) => {
      if (!u?.uid) return;

      let navigated = false;
      const ref = doc(db, 'users', u.uid);

      const unsubUser = onSnapshot(
        ref,
        { includeMetadataChanges: true },
        (snap) => {
          const data = snap.data() as any | undefined;
          const fromCache = snap.metadata.fromCache;

          if (data) {
            const ok = isApproved(data);
            if (!navigated && ok) {
              // Aprobado: permitimos navegar incluso si viene de caché (soporta offline).
              navigated = true;
              router.replace('/(tabs)');
            } else if (!navigated && !ok && !fromCache) {
              // No aprobado y dato confirmado por servidor => pending.
              navigated = true;
              router.replace('/auth/pending');
            }
          } else {
            // Sin doc: solo mandamos a pending cuando NO es caché (evita bucles por datos incompletos).
            if (!fromCache && !navigated) {
              navigated = true;
              router.replace('/auth/pending');
            }
          }
        },
        // Error leyendo user (p.ej. permission-denied): no crashear ni navegar en ciego.
        () => {}
      );

      return () => {
        unsubUser();
      };
    });

    return () => unsubAuth();
  }, []);

  const registerSmart = async (emailArg: string, passArg: string, nameArg?: string) => {
    const fn: any = registerEmail as any;
    if (typeof fn !== 'function') throw new Error('registerEmail no disponible');
    if (fn.length >= 3) return fn(emailArg, passArg, nameArg ?? undefined);
    return fn(emailArg, passArg);
  };

  const submit = async () => {
    try {
      setLoading(true);

      if (mode === 'login') {
        await loginEmail(email.trim(), pass);

        // La navegación la decide el listener onAuthStateChanged + onSnapshot.
        const u = firebaseAuth.currentUser;
        if (!u?.uid) throw new Error('No se pudo obtener la sesión.');

        const userPayload = {
          uid: u.uid,
          email: u.email ?? null,
          displayName: u.displayName ?? (u.email ? u.email.split('@')[0] : null),
          approved: false,
          lastLoginAt: serverTimestamp(),
        };

        // Evita romper flujo si reglas niegan escritura a usuario sin rol
        try {
          await upsertUser(u.uid, userPayload);
        } catch (err: any) {
          if (String(err?.code) !== 'permission-denied') throw err;
        }

        // IMPORTANTE: en login NO creamos athlete (evita permission-denied y bucles).
        return;
      }

      // ===== REGISTRO =====
      await registerSmart(email.trim(), pass, fullName.trim() || undefined);
      const u = firebaseAuth.currentUser;
      if (!u?.uid) throw new Error('No se pudo obtener el usuario luego de registrar.');

      const birthISO = birth ? toISOFromDDMMYYYY(birth) : null;
      const rutSave = normalizeRutToSave(rutDisplay) || null;
      const displayNameSafe = fullName.trim() || u.displayName || (u.email ? u.email.split('@')[0] : 'Usuario');

      const userPayload = {
        uid: u.uid,
        email: u.email ?? null,
        displayName: displayNameSafe,
        approved: false,
        requestedRole: isGuardian ? 'guardian' : 'athlete',
        fullName: displayNameSafe,
        rut: rutSave,
        birth: birthISO || null,
        isGuardian,
        athleteName: isGuardian ? (athleteName.trim() || null) : null,
        notes: notes.trim() || null,
        registrationAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      // Tolerar reglas estrictas: si no puede escribir aún, no bloquear el flujo
      try {
        await upsertUser(u.uid, userPayload);
      } catch (err: any) {
        if (String(err?.code) !== 'permission-denied') throw err;
      }

      const athleteNameFinal = isGuardian ? (athleteName.trim() || 'Nadador/a') : displayNameSafe;
      const athletePayload = {
        name: athleteNameFinal,
        birth: birthISO || null,
        birthDisplay: birth || null,
        rut: rutSave,
        rutDisplay: rutDisplay || null,
        gender: null,
        seasonYear: null,
        ageOnJan1: null,
        category: null,
        status: 'active',
        createdAt: serverTimestamp(),
      };

      // También tolerar reglas en athletes durante registro
      try {
        await upsertAthlete(u.uid, athletePayload);
      } catch (err: any) {
        if (String(err?.code) !== 'permission-denied') throw err;
      }

      // La navegación (pending/tabs) la decidirá el listener superior según el doc de users.
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo completar la acción');
    } finally {
      setLoading(false);
    }
  };

  const kbBehavior = Platform.OS === 'ios' ? 'padding' : 'height';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'right', 'left', 'bottom']}>
      <Gradient
        colors={GRADIENT_COLORS}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView behavior={kbBehavior} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingTop: 24,
            paddingBottom: Math.max(24, insets.bottom + 24),
            justifyContent: 'center',
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <Image source={brandLogoLight} style={{ width: 120, height: 120, marginBottom: 8 }} resizeMode="contain" />
            <Text style={styles.brand}>Club de Natación</Text>
            <Text style={styles.subtitle}>{mode === 'login' ? 'Accede a tu cuenta' : 'Solicita tu registro'}</Text>
          </View>

          {mode === 'login' && (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                placeholder="tucorreo@dominio.cl"
                placeholderTextColor="rgba(255,255,255,0.65)"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />

              <Text style={styles.label}>Contraseña</Text>
              <TextInput
                placeholder="••••••••"
                placeholderTextColor="rgba(255,255,255,0.65)"
                style={styles.input}
                value={pass}
                onChangeText={setPass}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={submit}
              />
            </>
          )}

          {mode === 'register' && (
            <>
              <Text style={styles.label}>Nombre completo</Text>
              <TextInput
                placeholder="Juan Pérez"
                placeholderTextColor="rgba(255,255,255,0.65)"
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                returnKeyType="next"
              />

              {/* RUT con anti-rebote + control de cursor */}
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
                // @ts-ignore (Android) evita autofill del sistema
                importantForAutofill="no"
                maxLength={12}
                returnKeyType="next"
                ref={rutRef}
                placeholder="11.111.111-1"
                placeholderTextColor="rgba(255,255,255,0.65)"
                style={styles.input}
              />

              <Text style={styles.label}>Fecha de nacimiento</Text>
              <TextInput
                placeholder="DD/MM/AAAA"
                placeholderTextColor="rgba(255,255,255,0.65)"
                style={styles.input}
                value={birth}
                onChangeText={(t) => {
                  const masked = maskDateDDMMYYYY(String(t));
                  if (masked !== birth) setBirth(masked);
                }}
                keyboardType="number-pad"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="none"
                autoComplete="off"
                importantForAutofill="no"
                maxLength={10}
                returnKeyType="next"
              />

              <Text style={styles.label}>Email</Text>
              <TextInput
                placeholder="tucorreo@dominio.cl"
                placeholderTextColor="rgba(255,255,255,0.65)"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
              />

              <Text style={styles.label}>Contraseña</Text>
              <TextInput
                placeholder="••••••••"
                placeholderTextColor="rgba(255,255,255,0.65)"
                style={styles.input}
                value={pass}
                onChangeText={setPass}
                secureTextEntry
                returnKeyType="next"
              />

              <View style={styles.switchRow}>
                <Text style={[styles.label, { marginTop: 0, flex: 1 }]}>Soy apoderado</Text>
                <Switch value={isGuardian} onValueChange={setIsGuardian} />
              </View>

              {isGuardian && (
                <>
                  <Text style={styles.label}>Nombre del nadador</Text>
                  <TextInput
                    placeholder="Nombre del atleta"
                    placeholderTextColor="rgba(255,255,255,0.65)"
                    style={styles.input}
                    value={athleteName}
                    onChangeText={setAthleteName}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </>
              )}

              <Text style={styles.label}>Comentarios (opcional)</Text>
              <TextInput
                placeholder="Cuéntanos algo relevante para tu registro…"
                placeholderTextColor="rgba(255,255,255,0.65)"
                style={[styles.input, { height: 96, textAlignVertical: 'top' }]}
                value={notes}
                onChangeText={setNotes}
                multiline
                returnKeyType="done"
              />
            </>
          )}

          <Text onPress={submit} style={[styles.btn, loading && { opacity: 0.7 }]}>
            {mode === 'login' ? 'Entrar' : 'Enviar solicitud'}
          </Text>

          <View style={{ height: 16 }} />
          {mode === 'login' ? (
            <Text style={styles.switch} onPress={() => setMode('register')}>
              ¿No tienes cuenta? <Text style={styles.linkStrong}>Regístrate</Text>
            </Text>
          ) : (
            <Text style={styles.switch} onPress={() => setMode('login')}>
              ¿Ya tienes cuenta? <Text style={styles.linkStrong}>Inicia sesión</Text>
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: { color: '#FFFFFF', fontWeight: '900', fontSize: 22, letterSpacing: 0.3 },
  subtitle: { color: 'rgba(255,255,255,0.85)', marginTop: 4, marginBottom: 8, fontWeight: '600' },
  label: { color: 'rgba(255,255,255,0.9)', fontWeight: '700', marginTop: 10, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  btn: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    color: '#fff',
    textAlign: 'center',
    paddingVertical: 14,
    borderRadius: 24,
    fontWeight: '800',
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  switch: { color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  linkStrong: { color: '#FFFFFF', fontWeight: '900' },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
});
