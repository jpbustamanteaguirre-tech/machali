// app/config/import.tsx
import * as Clipboard from 'expo-clipboard';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { db } from '../../../src/services/firebase';
import { useAuth } from '../../../src/stores/authStore';

const BG = '#F7F8FA';
const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BORDER = '#E6E8EC';
const MUTED = '#8A98A8';

type RowCSV = {
  categoria: string;     // p.ej. "Juv A1"
  genero: 'Mujeres' | 'Hombres';
  distancia: number;     // 50 | 100 | 200 | ...
  estilo: 'Libre' | 'Espalda' | 'Pecho' | 'Mariposa' | 'Combinado';
  marca: string;         // "00:35.17" | "01:16.82" | "S/MM"
};

function normalizeGender(g: string): 'Mujeres' | 'Hombres' {
  const s = (g || '').toLowerCase();
  if (s.startsWith('muj')) return 'Mujeres';
  return 'Hombres';
}
function genderToCode(g: 'Mujeres' | 'Hombres'): 'female' | 'male' {
  return g === 'Mujeres' ? 'female' : 'male';
}
function normalizeStyle(s: string): RowCSV['estilo'] {
  const k = (s || '').toLowerCase();
  if (k.startsWith('esp')) return 'Espalda';
  if (k.startsWith('pec') || k.startsWith('pech')) return 'Pecho';
  if (k.startsWith('mar')) return 'Mariposa';
  if (k.startsWith('comb') || k.startsWith('med')) return 'Combinado';
  return 'Libre';
}
function parseTimeToMsOrNull(timeStr: string): number | null {
  const s = (timeStr || '').trim();
  if (!s || s.toUpperCase() === 'S/MM') return null;
  const safe = s.replace(',', '.');
  const parts = safe.split(':'); // SS.cc | MM:SS.cc | HH:MM:SS.cc
  let h = 0, m = 0, sec = 0, cen = 0;
  if (parts.length === 1) {
    const [s1, c1] = parts[0].split('.');
    sec = parseInt(s1 || '0', 10);
    cen = parseInt((c1 || '0').padEnd(2, '0').slice(0, 2), 10);
  } else if (parts.length === 2) {
    m = parseInt(parts[0] || '0', 10);
    const [s1, c1] = parts[1].split('.');
    sec = parseInt(s1 || '0', 10);
    cen = parseInt((c1 || '0').padEnd(2, '0').slice(0, 2), 10);
  } else if (parts.length === 3) {
    h = parseInt(parts[0] || '0', 10);
    m = parseInt(parts[1] || '0', 10);
    const [s1, c1] = parts[2].split('.');
    sec = parseInt(s1 || '0', 10);
    cen = parseInt((c1 || '0').padEnd(2, '0').slice(0, 2), 10);
  } else {
    return null;
  }
  return ((h * 3600 + m * 60 + sec) * 1000) + cen * 10;
}
function buildId(seasonYear: number, r: RowCSV) {
  // ID determinista para hacer upsert
  const genderCode = genderToCode(r.genero);
  return `${seasonYear}-${r.categoria}-${genderCode}-${r.distancia}-${r.estilo}`.replace(/\s+/g, '');
}

export default function ImportFromClipboard() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [raw, setRaw] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const seasonYear = useMemo(() => new Date().getFullYear(), []);

  async function pasteFromClipboard() {
    const txt = await Clipboard.getStringAsync();
    if (!txt) {
      Alert.alert('Portapapeles vacío', 'Copia el CSV y vuelve a intentar.');
      return;
    }
    setRaw(txt);
  }

  function parseCSV(input: string): RowCSV[] {
    // Soporta con o sin encabezado.
    // Separador: coma, punto y coma o tab.
    const lines = (input || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !!l);

    if (lines.length === 0) return [];

    const sep = lines[0].includes('\t') ? '\t'
      : (lines[0].includes(';') ? ';' : ',');

    const headerLike = lines[0].toLowerCase().includes('categoria');
    const start = headerLike ? 1 : 0;

    const rows: RowCSV[] = [];
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((c) => c.trim());
      if (cols.length < 5) continue;

      const categoria = cols[0] || '';
      const genero = normalizeGender(cols[1]) as RowCSV['genero'];
      const distancia = parseInt(cols[2], 10);
      const estilo = normalizeStyle(cols[3]);
      const marca = cols[4];

      if (!categoria || !distancia || !estilo || !marca) continue;

      rows.push({ categoria, genero, distancia, estilo, marca });
    }
    return rows;
  }

  async function handleImport() {
    if (!isAdmin) {
      Alert.alert('Permiso denegado', 'Solo un administrador puede importar.');
      return;
    }
    const rows = parseCSV(raw);
    if (rows.length === 0) {
      Alert.alert('Sin filas válidas', 'Revisa el formato (categoria,genero,distancia,estilo,marca).');
      return;
    }

    setLoading(true);
    setCount(null);

    try {
      let ok = 0;
      for (const r of rows) {
        const id = buildId(seasonYear, r);
        const payload = {
          id,
          seasonYear,
          category: r.categoria,
          genderDisplay: r.genero,              // "Mujeres" | "Hombres"
          gender: genderToCode(r.genero),       // "female" | "male"
          distance: r.distancia,
          style: r.estilo,                      // "Libre" | "Espalda" | ...
          timeStr: r.marca,
          timeMs: parseTimeToMsOrNull(r.marca), // null si S/MM
          source: 'Nacional',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'qualifyingStandards', id), payload, { merge: true });
        ok++;
      }
      setCount(ok);
      Alert.alert('Importación completa', `Registros procesados: ${ok}`);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error al importar', e?.message || 'Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: NAVY }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Importar mínimas (CSV)</Text>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={styles.card}>
            <Text style={styles.p}>
              Pega aquí el CSV con columnas:{' '}
              <Text style={{ fontWeight: '800' }}>categoria, genero, distancia, estilo, marca</Text>.
            </Text>

            <TextInput
              multiline
              value={raw}
              onChangeText={setRaw}
              placeholder="categoria,genero,distancia,estilo,marca&#10;Juv A1,Mujeres,50,Libre,00:35.17"
              placeholderTextColor={MUTED}
              style={styles.input}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TouchableOpacity onPress={pasteFromClipboard} style={[styles.btn, { backgroundColor: '#fff', borderColor: BORDER, borderWidth: 1 }]}>
                <Text style={[styles.btnText, { color: NAVY }]}>Pegar del portapapeles</Text>
              </TouchableOpacity>

              <TouchableOpacity disabled={loading || !isAdmin} onPress={handleImport} style={[styles.btn, (loading || !isAdmin) && { opacity: 0.6 }]}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Importar</Text>}
              </TouchableOpacity>
            </View>

            {count != null && (
              <Text style={[styles.p, { marginTop: 8 }]}>
                Registros importados/actualizados: <Text style={{ fontWeight: '800' }}>{count}</Text>
              </Text>
            )}

            {!isAdmin && (
              <Text style={[styles.p, { marginTop: 8, color: RED }]}>
                Solo un administrador puede ejecutar esta acción.
              </Text>
            )}
          </View>

          <View style={[styles.card, { marginTop: 12 }]}>
            <Text style={styles.subTitle}>Estructura guardada (colección: qualifyingStandards)</Text>
            <Text style={styles.code}>
{`- id: string (season-category-gender-distance-style)
- seasonYear: number
- category: string
- genderDisplay: 'Mujeres' | 'Hombres'
- gender: 'female' | 'male'
- distance: number
- style: 'Libre' | 'Espalda' | 'Pecho' | 'Mariposa' | 'Combinado'
- timeStr: string (p.ej. "01:16.82" o "S/MM")
- timeMs: number | null
- source: 'Nacional'
- createdAt/updatedAt: serverTimestamp()`}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Overlay inferior exacto */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom, backgroundColor: NAVY }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  p: { color: NAVY, fontSize: 14, lineHeight: 20 },
  subTitle: { color: NAVY, fontWeight: '800', marginBottom: 6 },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    color: MUTED,
    backgroundColor: '#FAFBFC',
    padding: 10,
    borderRadius: 8,
    borderColor: BORDER,
    borderWidth: 1,
  },
  input: {
    marginTop: 10,
    minHeight: 160,
    borderRadius: 8,
    borderColor: BORDER,
    borderWidth: 1,
    padding: 10,
    color: NAVY,
    backgroundColor: '#fff',
  },
  btn: {
    flex: 1,
    backgroundColor: RED,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontWeight: '800' },
});
