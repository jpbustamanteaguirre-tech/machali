// app/config/pending.tsx
import { router } from 'expo-router';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';

const BG = '#F7F8FA';
const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BORDER = '#E6E8EC';
const MUTED = '#8A98A8';
const CHIP_BG = '#EDEFF3';
const WHITE = '#fff';

type PendingUser = {
  id: string;
  fullName?: string | null;
  displayName?: string | null;
  email?: string | null;
  rut?: string | null;
  requestedRole?: 'athlete' | 'guardian' | 'coach' | 'admin';
  isGuardian?: boolean;
  athleteName?: string | null;
  notes?: string | null;
  approved?: boolean;
  status?: 'pending' | 'approved' | 'rejected';
  registrationAt?: any;
};

function toTitleCase(s?: string | null) {
  return String(s ?? '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

export default function AdminPendingApprovals() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PendingUser[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<PendingUser | null>(null);

  useEffect(() => {
    const qy = query(
      collection(db, 'users'),
      where('status', '==', 'pending'),
      orderBy('registrationAt', 'asc')
    );
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr: PendingUser[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setItems(arr);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
        <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: NAVY }}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.backText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Solicitudes</Text>
            <Text style={[styles.menuIcon, { opacity: 0 }]}>&nbsp;</Text>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
        </SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: NAVY }}>No tienes permiso para ver esta sección.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const openItem = (u: PendingUser) => {
    setSel(u);
    setOpen(true);
  };

  const approve = async (u: PendingUser) => {
    try {
      const batch = writeBatch(db);

      // Normaliza nombre visible
      const displayName = toTitleCase(u.displayName || u.fullName || 'Usuario');

      // Decide rol final (respetando requestedRole cuando esté)
      let role: 'athlete' | 'guardian' | 'coach' | 'admin' = 'athlete';
      if (u.requestedRole === 'guardian') role = 'guardian';
      if (u.requestedRole === 'coach') role = 'coach';
      if (u.requestedRole === 'admin') role = 'admin';

      // Actualiza el usuario
      batch.update(doc(db, 'users', u.id), {
        approved: true,
        status: 'approved',
        role,
        displayName,
        updatedAt: serverTimestamp(),
      });

      // Si es atleta, crea ficha en athletes (si quieres evitar duplicados, aquí puedes consultar primero)
      if (role === 'athlete') {
        const athleteRef = doc(collection(db, 'athletes'));
        batch.set(athleteRef, {
          name: displayName,
          userUid: u.id,
          status: 'active',
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      Alert.alert('Listo', 'Solicitud aprobada.');
      setOpen(false);
      setSel(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo aprobar.');
    }
  };

  const reject = async (u: PendingUser) => {
    try {
      await updateDoc(doc(db, 'users', u.id), {
        approved: false,
        status: 'rejected',
        updatedAt: serverTimestamp(),
      });
      Alert.alert('Listo', 'Solicitud rechazada.');
      setOpen(false);
      setSel(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo rechazar.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      {/* Header */}
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: NAVY }}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Solicitudes</Text>
          <Text style={[styles.menuIcon, { opacity: 0 }]}>&nbsp;</Text>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 12 }}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <Text style={{ color: NAVY }}>No hay solicitudes pendientes.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const name = toTitleCase(item.displayName || item.fullName || 'Usuario');
            return (
              <TouchableOpacity onPress={() => openItem(item)} activeOpacity={0.85} style={styles.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={{ color: NAVY, fontWeight: '800' }}>{name}</Text>
                    <Text style={{ color: MUTED, marginTop: 2 }} numberOfLines={1}>
                      {item.email || '—'}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <View style={styles.badge}>
                        <Text style={styles.badgeTxt}>Rol solicitado: {item.requestedRole || 'athlete'}</Text>
                      </View>
                      {item.rut ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeTxt}>RUT: {item.rut}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Text style={{ color: NAVY, fontWeight: '800' }}>Ver</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Modal detalle */}
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
        <View style={styles.modalCard}>
          <Text style={{ color: NAVY, fontWeight: '800', fontSize: 16, marginBottom: 8 }}>
            {toTitleCase(sel?.displayName || sel?.fullName || 'Usuario')}
          </Text>

          <View style={[styles.subCard, { marginTop: 6 }]}>
            <Text style={{ color: NAVY, fontWeight: '800' }}>Datos</Text>
            <Text style={{ color: MUTED, marginTop: 4 }}>Email: {sel?.email || '—'}</Text>
            <Text style={{ color: MUTED, marginTop: 2 }}>Rol solicitado: {sel?.requestedRole || 'athlete'}</Text>
            {sel?.isGuardian ? (
              <>
                <Text style={{ color: MUTED, marginTop: 2 }}>Apoderado</Text>
                <Text style={{ color: MUTED, marginTop: 2 }}>
                  Alumno: {toTitleCase(sel?.athleteName || '—')}
                </Text>
              </>
            ) : null}
            {sel?.notes ? (
              <Text style={{ color: MUTED, marginTop: 2 }}>Notas: {sel?.notes}</Text>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <TouchableOpacity
              onPress={() => sel && reject(sel)}
              style={[styles.smallBtn, { backgroundColor: MUTED }]}
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>Rechazar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => sel && approve(sel)}
              style={[styles.smallBtn, { backgroundColor: RED }]}
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>Aprobar</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => setOpen(false)} style={{ marginTop: 10 }}>
            <Text style={styles.menuCancel}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
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
    includeFontPadding: false as any,
  },
  backText: { color: '#fff', fontSize: 18, includeFontPadding: false as any },
  menuIcon: { color: '#fff', fontSize: 22, fontWeight: '800', includeFontPadding: false as any },

  // Tarjetas / badges
  card: {
    backgroundColor: WHITE,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
  },
  badge: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CHIP_BG,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  badgeTxt: { color: NAVY, fontWeight: '800', fontSize: 12 },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: '18%',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  subCard: {
    backgroundColor: '#FAFBFD',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 10,
  },
  smallBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  menuCancel: {
    color: NAVY,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
});
