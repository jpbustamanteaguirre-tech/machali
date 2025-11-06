// app/config/import.tsx
import { router } from 'expo-router';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';

const NAVY = '#0B1E2F';
const BG = '#F7F8FA';
const RED = '#CE2434';
const BORDER = '#E6E8EC';
const MUTED = '#8A98A8';
const WHITE = '#FFFFFF';

// Colecciones a procesar (agrega/quita según necesites)
const COLLECTIONS = [
  'athletes',
  'groups',
  'events',
  'results',
  'attendance',
  'attendanceMeta',
  'users',
  // marcas mínimas
  'qualifyingStandards',
] as const;

export default function BackfillUpdatedAtScreen() {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [updated, setUpdated] = useState(0);
  const [collectionIdx, setCollectionIdx] = useState(0);

  const push = (m: string) => setLog((p) => [m, ...p].slice(0, 200));

  async function backfillAllCollections() {
    if (running) return;
    setRunning(true);
    setUpdated(0);
    setCollectionIdx(0);
    setLog([]);

    try {
      for (let c = 0; c < COLLECTIONS.length; c++) {
        const colName = COLLECTIONS[c];
        setCollectionIdx(c + 1);
        push(`→ Procesando colección "${colName}"...`);

        const snap = await getDocs(collection(db, colName));
        const docs = snap.docs;

        if (!docs.length) {
          push(`(vacía) No hay documentos en "${colName}".`);
          // Aún así marcamos meta/<colección>.lastUpdatedAt
          await setDoc(
            doc(db, 'meta', colName),
            { lastUpdatedAt: serverTimestamp() },
            { merge: true }
          );
          push(`📦 meta/${colName}.lastUpdatedAt actualizado (colección vacía).`);
          continue;
        }

        const CHUNK = 400; // margen seguro para lotes
        let total = 0;

        for (let i = 0; i < docs.length; i += CHUNK) {
          const slice = docs.slice(i, i + CHUNK);
          const batch = writeBatch(db);

          slice.forEach((d) => {
            batch.set(
              doc(db, colName, d.id),
              { updatedAt: serverTimestamp() },
              { merge: true }
            );
          });

          await batch.commit();
          total += slice.length;
          setUpdated((prev) => prev + slice.length);
          push(`✅ ${colName}: ${total}/${docs.length} documentos marcados.`);
        }

        // Actualiza meta/<colección>.lastUpdatedAt
        await setDoc(
          doc(db, 'meta', colName),
          { lastUpdatedAt: serverTimestamp() },
          { merge: true }
        );
        push(`📦 meta/${colName}.lastUpdatedAt actualizado.`);
      }

      Alert.alert('Listo', 'Todas las colecciones fueron actualizadas con updatedAt.');
      push('🎉 Proceso completo.');
    } catch (e: any) {
      console.error(e);
      push(`Error: ${e?.message || 'desconocido'}`);
      Alert.alert('Error', e?.message || 'No se pudo completar el proceso.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      {/* Header NAVY */}
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: NAVY }}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.9}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>
            Utilidad · Backfill de updatedAt (todas)
          </Text>
          <Text style={[styles.menuIcon, { opacity: 0 }]}>☰</Text>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backfill general de updatedAt</Text>
          <Text style={styles.cardDesc}>
            Este proceso agrega o actualiza el campo <Text style={styles.bold}>updatedAt</Text> en
            todas las colecciones principales de Firestore:{' '}
            <Text style={styles.bold}>{COLLECTIONS.join(', ')}</Text>. También actualiza los
            registros <Text style={styles.bold}>meta/&lt;colección&gt;.lastUpdatedAt</Text>.
          </Text>

          <TouchableOpacity
            onPress={backfillAllCollections}
            disabled={running}
            activeOpacity={0.9}
            style={[styles.btn, running && { opacity: 0.7 }]}
          >
            {running ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.btnText}>
                  Procesando… {collectionIdx}/{COLLECTIONS.length} colecciones ({updated} docs)
                </Text>
              </View>
            ) : (
              <Text style={styles.btnText}>Ejecutar backfill</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { marginTop: 12 }]}>
          <Text style={styles.cardTitle}>Registro</Text>
          <View style={styles.logBox}>
            {log.length === 0 ? (
              <Text style={{ color: MUTED, fontWeight: '700' }}>Sin mensajes aún…</Text>
            ) : (
              log.map((l, i) => (
                <Text key={i} style={{ color: NAVY, fontWeight: '700', marginBottom: 4 }}>
                  • {l}
                </Text>
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* === estilos === */
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
    textAlign: 'center',
    includeFontPadding: false as any,
  },
  backText: { color: '#fff', fontSize: 18, includeFontPadding: false as any },
  menuIcon: { color: '#fff', fontSize: 22, fontWeight: '800', includeFontPadding: false as any },

  card: {
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  cardTitle: { color: NAVY, fontWeight: '900', fontSize: 16, marginBottom: 6 },
  cardDesc: { color: MUTED, fontWeight: '700', lineHeight: 20 },

  btn: {
    marginTop: 12,
    backgroundColor: RED,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontWeight: '900' },

  logBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#FBFCFE',
  },
  bold: { color: NAVY, fontWeight: '900' },
});
