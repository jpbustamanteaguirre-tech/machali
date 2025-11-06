// app/profile/edit.tsx
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { uploadProfileDataURL } from '../../src/utils/storage'; // 👈 Subida a Storage

const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';
const MUTED = '#8A98A8';
const WHITE = '#fff';

const MAX_DATAURL_BYTES = 700_000; // por debajo del límite de Firestore
const PHONE_PREFIX = '+56';

function toTitleCase(s?: string) {
  return String(s ?? '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}
function onlyDigits(s?: string) {
  return String(s ?? '').replace(/\D/g, '');
}

export default function ProfileEdit() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const uid = user?.uid;

  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [pickedDataUrl, setPickedDataUrl] = useState<string | null>(null);

  const [phoneDigits, setPhoneDigits] = useState(''); // solo 9 dígitos
  const phoneE164 = useMemo(
    () => (phoneDigits.length === 9 ? `${PHONE_PREFIX}${phoneDigits}` : ''),
    [phoneDigits]
  );

  // Cursos y actualizaciones (índice 0 = mayor importancia)
  const [courses, setCourses] = useState<string[]>(['']);
  const hasNonEmptyCourse = useMemo(
    () => courses.some((c) => c.trim().length > 0),
    [courses]
  );

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) {
        const u = snap.data() as any;
        setDisplayName(u?.displayName ?? user?.displayName ?? '');
        setPhotoURL(u?.photoURL ?? user?.photoURL ?? null);

        const existingPhone: string | undefined = u?.phone;
        if (existingPhone?.startsWith(PHONE_PREFIX)) {
          setPhoneDigits(onlyDigits(existingPhone.slice(PHONE_PREFIX.length)).slice(0, 9));
        } else if (u?.phoneDigits) {
          setPhoneDigits(String(u.phoneDigits).slice(0, 9));
        }

        const existingCourses: string[] = Array.isArray(u?.courses) ? u.courses : [];
        setCourses(
          existingCourses.length ? existingCourses.map((x) => String(x ?? '')) : ['']
        );
      } else {
        setDisplayName(user?.displayName ?? '');
        setPhotoURL(user?.photoURL ?? null);
        setPhoneDigits('');
        setCourses(['']);
      }
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  const askPickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tu galería para cambiar la foto.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      // ✅ API nueva: reemplaza MediaTypeOptions por MediaType
      mediaTypes: ['images'], // ✅ nueva API compatible
      quality: 0.4,
      allowsEditing: true,
      aspect: [1, 1],
      base64: true,
    });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.base64) {
      Alert.alert('Ups', 'No pudimos leer la imagen.');
      return;
    }

    const mime = asset.mimeType || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${asset.base64}`;
    const approxBytes = Math.ceil((dataUrl.length * 3) / 4);

    if (approxBytes > MAX_DATAURL_BYTES) {
      Alert.alert('Imagen muy grande', 'Recorta o elige una imagen más pequeña.');
      return;
    }
    setPickedDataUrl(dataUrl);
  };

  const clearPhoto = () => {
    setPickedDataUrl(null);
    setPhotoURL(null);
  };

  // Cursos
  const setCourseAt = (i: number, val: string) => {
    setCourses((prev) => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  };
  const addCourse = () => setCourses((prev) => [...prev, '']);
  const removeCourse = (i: number) => {
    setCourses((prev) =>
      prev.filter((_, idx) => idx !== i).length ? prev.filter((_, idx) => idx !== i) : ['']
    );
  };
  const moveUp = (i: number) => {
    if (i <= 0) return;
    setCourses((prev) => {
      const n = [...prev];
      const t = n[i - 1];
      n[i - 1] = n[i];
      n[i] = t;
      return n;
    });
  };
  const moveDown = (i: number) => {
    setCourses((prev) => {
      if (i >= prev.length - 1) return prev;
      const n = [...prev];
      const t = n[i + 1];
      n[i + 1] = n[i];
      n[i] = t;
      return n;
    });
  };

  const submit = async () => {
    const errs: string[] = [];
    if (!toTitleCase(displayName).trim()) errs.push('Nombre requerido.');
    const digits = onlyDigits(phoneDigits).slice(0, 9);
    if (digits.length !== 9) errs.push('El teléfono debe tener 9 dígitos (sin contar +56).');

    const cleanedCourses = courses.map((c) => c.trim()).filter((c) => c.length > 0);

    if (errs.length) {
      Alert.alert('Revisa los campos', errs.join('\n'));
      return;
    }
    if (!uid) {
      Alert.alert('Error', 'Usuario no autenticado.');
      return;
    }

    try {
      let finalPhotoURL: string | null = photoURL ?? null;

      // Migración / subida:
      const candidate = pickedDataUrl || (photoURL?.startsWith('data:') ? photoURL : null);
      if (candidate && candidate.startsWith('data:')) {
        finalPhotoURL = await uploadProfileDataURL(uid, candidate); // 👈 URL https
      }

      await updateDoc(doc(db, 'users', uid), {
        displayName: toTitleCase(displayName.trim()),
        phone: `${PHONE_PREFIX}${digits}`,
        phoneDigits: digits,
        photoURL: finalPhotoURL, // 👈 guardamos solo URL o null
        courses: cleanedCourses,
      });

      // Limpia el dataURL local
      setPickedDataUrl(null);

      Alert.alert('Listo', 'Perfil actualizado');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo actualizar el perfil.');
    }
  };

  // Evita error al usar KeyboardAvoidingView
  const kbBehavior: 'padding' | 'height' =
    Platform.OS === 'ios' ? 'padding' : 'height';
  const kbOffset = Platform.OS === 'ios' ? 0 : 56;

  return (
    // SIN 'bottom' para no agregar aire extra. La línea azul la dibuja el overlay al final.
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      {/* Header NAVY unificado */}
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: NAVY }}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>
            Editar perfil
          </Text>
          {/* Placeholder de métrica a la derecha */}
          <Text style={[styles.menuIcon, { opacity: 0 }]}>☰</Text>
        </View>
        <View style={styles.headerDivider} />
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={kbBehavior}
          keyboardVerticalOffset={kbOffset}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingBottom: 8 + insets.bottom }} // mínimo aire
          >
            {/* Foto */}
            <View style={styles.card}>
              <Text style={styles.title}>Foto de perfil</Text>
              <View style={{ alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
                {pickedDataUrl || photoURL ? (
                  <Image source={{ uri: pickedDataUrl ?? photoURL! }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={{ color: NAVY, fontWeight: '900' }}>Foto</Text>
                  </View>
                )}
              </View>
              <View style={{ marginTop: 12, flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <TouchableOpacity onPress={askPickPhoto} style={styles.photoBtn}>
                  <Text style={styles.photoBtnTxt}>Cambiar foto</Text>
                </TouchableOpacity>
                {(pickedDataUrl || photoURL) && (
                  <TouchableOpacity
                    onPress={clearPhoto}
                    style={[
                      styles.photoBtn,
                      { backgroundColor: '#EDEFF3', borderColor: '#D3D9E0' },
                    ]}
                  >
                    <Text style={[styles.photoBtnTxt, { color: NAVY }]}>Quitar</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
                Subimos la imagen a Storage y guardamos solo la URL.
              </Text>
            </View>

            {/* Datos */}
            <View style={styles.card}>
              <Text style={styles.title}>Datos</Text>

              <Text style={styles.label}>Nombre</Text>
              <TextInput
                value={displayName}
                onChangeText={(t) => setDisplayName(toTitleCase(t))}
                placeholder="Nombre y Apellido"
                placeholderTextColor={MUTED}
                style={styles.input}
              />

              <Text style={styles.label}>Teléfono</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <View
                  style={[
                    styles.input,
                    { flex: 0, width: 84, alignItems: 'center', justifyContent: 'center' },
                  ]}
                >
                  <Text style={{ color: NAVY, fontWeight: '800' }}>{PHONE_PREFIX}</Text>
                </View>
                <TextInput
                  value={phoneDigits}
                  onChangeText={(t) => setPhoneDigits(onlyDigits(t).slice(0, 9))}
                  keyboardType="number-pad"
                  placeholder="9 dígitos"
                  placeholderTextColor={MUTED}
                  style={[styles.input, { flex: 1 }]}
                  maxLength={9}
                />
              </View>
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 4 }}>
                Ingresa solo 9 dígitos (ej: 912345678). Se guardará como {PHONE_PREFIX}XXXXXXXXX.
              </Text>
            </View>

            {/* Cursos y actualizaciones */}
            <View style={styles.card}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={styles.title}>Cursos y Actualizaciones</Text>
                <TouchableOpacity onPress={addCourse} style={styles.btnMini}>
                  <Text style={styles.btnMiniText}>Agregar</Text>
                </TouchableOpacity>
              </View>

              {courses.map((c, idx) => (
                <View key={`c-${idx}`} style={styles.courseRow}>
                  <Text style={styles.courseBadge}>{idx + 1}</Text>
                  <TextInput
                    value={c}
                    onChangeText={(t) => setCourseAt(idx, t)}
                    placeholder='Nombre del curso (p. ej., “RCP Avanzado 2024”)'
                    placeholderTextColor={MUTED}
                    style={[styles.input, { flex: 1, marginTop: 0 }]}
                  />
                  <View style={{ flexDirection: 'row', gap: 6, marginLeft: 6 }}>
                    <TouchableOpacity onPress={() => moveUp(idx)} style={styles.btnMiniIcon}>
                      <Text style={styles.btnMiniIconTxt}>▲</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => moveDown(idx)} style={styles.btnMiniIcon}>
                      <Text style={styles.btnMiniIconTxt}>▼</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => removeCourse(idx)}
                      style={[styles.btnMiniIcon, { backgroundColor: RED }]}
                    >
                      <Text style={[styles.btnMiniIconTxt, { color: '#fff' }]}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              {!hasNonEmptyCourse && (
                <Text style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
                  Agrega al menos un curso para registrar tus capacitaciones.
                </Text>
              )}
            </View>

            <TouchableOpacity onPress={submit} style={{ marginTop: 16 }}>
              <Text style={styles.btnPrimary}>Guardar cambios</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Línea azul inferior EXACTA al inset del sistema */}
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
  menuIcon: { color: '#fff', fontSize: 22, fontWeight: '800', includeFontPadding: false as any },
  headerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 },

  // Cards
  card: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  title: { color: NAVY, fontWeight: '800', marginBottom: 8 },

  // Foto
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#DDE3EA' },
  avatarFallback: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#DDE3EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  photoBtnTxt: { color: NAVY, fontWeight: '700' },

  // Inputs
  label: { color: NAVY, fontWeight: '700', marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 14,
    color: NAVY,
    backgroundColor: '#fff',
    marginTop: 6,
    fontWeight: '700',
  },

  // Cursos
  courseRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  courseBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FAFBFD',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    color: NAVY,
    fontWeight: '800',
    marginRight: 8,
    textAlign: 'center',
  },

  btnMini: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: WHITE,
  },
  btnMiniText: { color: NAVY, fontWeight: '700', fontSize: 12 },

  btnMiniIcon: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE,
  },
  btnMiniIconTxt: { color: NAVY, fontWeight: '800' },

  // Botón guardar
  btnPrimary: {
    backgroundColor: RED,
    color: '#fff',
    textAlign: 'center',
    paddingVertical: 14,
    borderRadius: 24,
    fontWeight: '700',
    marginHorizontal: 16,
  },
});
