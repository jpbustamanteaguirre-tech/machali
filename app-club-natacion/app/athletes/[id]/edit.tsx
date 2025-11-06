
// app/athletes/[id]/edit.tsx
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
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
import { db } from '../../../src/services/firebase';

const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';
const MUTED = '#8A98A8';

/* =================== UTILIDADES LOCALES =================== */
function maskDateDigitsToDisplayLocal(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
function displayDateToISOLocal(display: string): string | null {
  const m = String(display ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = +m[1], mm = +m[2], yyyy = +m[3];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${String(yyyy).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
}
function cleanRut(input: string): string { return String(input ?? '').replace(/[^0-9kK]/g, '').toUpperCase(); }
function computeDV(numStr: string): string {
  let sum = 0, mul = 2;
  for (let i = numStr.length - 1; i >= 0; i--) {
    sum += parseInt(numStr[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const res = 11 - (sum % 11);
  if (res === 11) return '0';
  if (res === 10) return 'K';
  return String(res);
}
function rutToStorageLocal(input: string): string | null {
  const c = cleanRut(input);
  if (c.length < 2) return null;
  const body = c.slice(0, -1);
  const dv = c.slice(-1);
  if (!/^\d+$/.test(body)) return null;
  if (computeDV(body) !== dv) return null;
  return `${body}-${dv}`;
}
function rutToDisplayLocal(input: string): string {
  const store = rutToStorageLocal(input);
  if (!store) return String(input ?? '');
  const [body, dv] = store.split('-');
  const rev = body.split('').reverse().join('');
  const chunks = rev.match(/.{1,3}/g) ?? [];
  const dotted = chunks.map((c) => c.split('').reverse().join('')).reverse().join('.');
  return `${dotted}-${dv}`;
}
const toTitleCase = (s: string) =>
  (s || '').toLowerCase().split(' ').filter(Boolean).map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
/* ========================================================== */

export default function AthleteEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [birthDisplay, setBirthDisplay] = useState('');
  const [rutDisplay, setRutDisplay] = useState('');
  const [gender, setGender] = useState<'Masculino' | 'Femenino' | ''>('');
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [pickedDataUrl, setPickedDataUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string,string>>({});

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        const snap = await getDoc(doc(db, 'athletes', String(id)));
        if (snap.exists()) {
          const a = snap.data() as any;
          setName(a?.name ?? '');
          setBirthDisplay(a?.birthDisplay ?? '');
          setRutDisplay(a?.rutDisplay ?? '');
          setGender((a?.gender as any) ?? '');
          setPhotoURL(a?.photoURL ?? null);
        }
      } catch {}
      setLoading(false);
    };
    load();
  }, [id]);

  const askPickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tu galería para cambiar la foto.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.base64) { Alert.alert('Ups', 'No pudimos leer la imagen.'); return; }
    const mime = asset.mimeType || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${asset.base64}`;
    setPickedDataUrl(dataUrl);
  };

  const clearPhoto = () => {
    setPickedDataUrl(null);
    setPhotoURL(null);
  };

  const submit = async () => {
    const errs: Record<string,string> = {};
    if (!name.trim()) errs.name = 'Requerido';

    const birthISO = displayDateToISOLocal(birthDisplay);
    if (!birthISO) errs.birth = 'Fecha inválida (DD/MM/AAAA)';

    const rs = rutToStorageLocal(rutDisplay);
    if (!rs) errs.rut = 'RUT inválido';

    if (!gender) errs.gender = 'Selecciona género';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    try {
      await updateDoc(doc(db, 'athletes', String(id)), {
        name: toTitleCase(name.trim()),
        birth: birthISO!,
        birthDisplay,
        rut: rs!,
        rutDisplay: rutToDisplayLocal(rs!),
        gender,
        photoURL: pickedDataUrl ?? photoURL ?? null,
      });
      Alert.alert('Listo', 'Perfil actualizado');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo actualizar');
    }
  };

  const kbBehavior = Platform.OS === 'ios' ? 'padding' : 'height';
  const kbOffset = Platform.OS === 'ios' ? 0 : 56;

  return (
    // 👇 SIN 'bottom' para no añadir aire. El overlay NAVY pinta justo el inset del sistema.
    <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
      {/* Header NAVY UNIFICADO: misma medida que athletes/[id].tsx.
          Usamos un “☰” INVISIBLE a la derecha como referencia de altura/métrica. */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
        <View style={styles.headerRow}>
          {/* Atrás */}
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:8,bottom:8,left:8,right:8 }}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>

          {/* Título */}
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>
            Editar Nadador
          </Text>

          {/* Referencia métrica: ícono de menú invisible (no interactivo) */}
          <Text style={[styles.menuIcon, { opacity: 0 }]}>☰</Text>
        </View>
        <View style={styles.headerDivider} />
      </SafeAreaView>

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <Text style={{ color: NAVY }}>Cargando…</Text>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex:1 }} behavior={kbBehavior} keyboardVerticalOffset={kbOffset}>
          <ScrollView
            contentContainerStyle={{ padding:16, paddingBottom: Math.max(12, insets.bottom + 12) }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Foto de perfil + acciones */}
            <View style={styles.photoCard}>
              <View style={{ alignItems:'center', justifyContent:'center' }}>
                {pickedDataUrl || photoURL ? (
                  <Image source={{ uri: pickedDataUrl ?? photoURL! }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={{ color: NAVY, fontWeight:'900' }}>Foto</Text>
                  </View>
                )}
              </View>

              <View style={{ marginTop: 12, flexDirection:'row', gap:10, flexWrap:'wrap' }}>
                <TouchableOpacity onPress={askPickPhoto} style={styles.photoBtn}>
                  <Text style={styles.photoBtnTxt}>Cambiar foto</Text>
                </TouchableOpacity>
                {(pickedDataUrl || photoURL) && (
                  <TouchableOpacity onPress={clearPhoto} style={[styles.photoBtn, { backgroundColor:'#EDEFF3', borderColor:'#D3D9E0' }]}>
                    <Text style={[styles.photoBtnTxt, { color: NAVY }]}>Quitar</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
                Tip: por ahora guardamos la imagen en el perfil como *data URL* para el MVP.
              </Text>
            </View>

            {/* Formulario */}
            <Text style={styles.label}>Nombre completo</Text>
            <TextInput
              value={name}
              onChangeText={(t) => setName(toTitleCase(t))}
              placeholder="Juan Bustamante"
              placeholderTextColor={MUTED}
              style={styles.input}
            />
            {!!errors.name && <Text style={styles.error}>{errors.name}</Text>}

            <Text style={styles.label}>Fecha de nacimiento</Text>
            <TextInput
              value={birthDisplay}
              onChangeText={(t) => setBirthDisplay(maskDateDigitsToDisplayLocal(t ?? ''))}
              keyboardType="number-pad"
              placeholder="DD/MM/AAAA"
              placeholderTextColor={MUTED}
              style={styles.input}
            />
            {!!errors.birth && <Text style={styles.error}>{errors.birth}</Text>}

            <Text style={styles.label}>RUT</Text>
            <TextInput
              value={rutDisplay}
              onChangeText={(t) => setRutDisplay(rutToDisplayLocal(rutToStorageLocal(t) || t))}
              keyboardType="number-pad"
              placeholder="11.111.111-1"
              placeholderTextColor={MUTED}
              style={styles.input}
            />
            {!!errors.rut && <Text style={styles.error}>{errors.rut}</Text>}

            <Text style={styles.label}>Género</Text>
            <View style={{ flexDirection:'row', gap:10, marginTop:6 }}>
              <TouchableOpacity onPress={() => setGender('Masculino')} style={[styles.chip, gender==='Masculino' && styles.chipOn]}>
                <Text style={[styles.chipText, gender==='Masculino' && styles.chipTextOn]}>Masculino</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setGender('Femenino')} style={[styles.chip, gender==='Femenino' && styles.chipOn]}>
                <Text style={[styles.chipText, gender==='Femenino' && styles.chipTextOn]}>Femenino</Text>
              </TouchableOpacity>
            </View>
            {!!errors.gender && <Text style={styles.error}>{errors.gender}</Text>}

            <TouchableOpacity onPress={submit} style={{ marginTop:20 }}>
              <Text style={styles.btnPrimary}>Guardar cambios</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Overlay inferior EXACTO al inset del sistema (consistencia con pantallas secundarias) */}
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
  // Header unificado (idéntico a athletes/[id].tsx)
  headerRow: {
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection:'row',
    alignItems:'center',
    justifyContent:'space-between',
  },
  headerTitle: {
    color:'#fff',
    fontSize:18,
    fontWeight:'700',
    flex:1,
    paddingHorizontal: 12,
    includeFontPadding: false as any,
  },
  backText: { color:'#fff', fontSize:18, includeFontPadding: false as any },
  menuIcon: { color:'#fff', fontSize:22, fontWeight:'800', includeFontPadding: false as any },
  headerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 },

  // Foto
  photoCard: {
    backgroundColor:'#fff',
    borderWidth:1,
    borderColor:BORDER,
    borderRadius:12,
    padding:12,
    marginBottom: 8,
  },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#DDE3EA', alignSelf:'center' },
  avatarFallback: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#DDE3EA', alignSelf:'center', alignItems:'center', justifyContent:'center' },
  photoBtn: { borderWidth:1, borderColor: BORDER, backgroundColor:'#fff', borderRadius: 16, paddingHorizontal:12, paddingVertical:8 },
  photoBtnTxt: { color: NAVY, fontWeight:'700' },

  // Form
  label: { color: NAVY, fontWeight:'700', marginTop:10 },
  input: {
    borderWidth:1, borderColor:BORDER, borderRadius:12, height:48,
    paddingHorizontal:14, color:NAVY, backgroundColor:'#fff', marginTop:6,
  },
  chip: { borderWidth:1, borderColor:BORDER, borderRadius:20, paddingHorizontal:14, paddingVertical:8, backgroundColor:'#fff' },
  chipOn: { borderColor: NAVY, backgroundColor:'#E6EDF5' },
  chipText: { color: NAVY, fontWeight:'600' },
  chipTextOn: { color: NAVY, fontWeight:'800' },
  error: { color: RED, marginTop:6 },

  // Botón
  btnPrimary: { backgroundColor: RED, color:'#fff', textAlign:'center', paddingVertical:14, borderRadius:24, fontWeight:'700' },
});
