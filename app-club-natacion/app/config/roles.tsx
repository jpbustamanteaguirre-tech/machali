// app/config/roles.tsx
import { router } from 'expo-router';
import { collection, doc, onSnapshot, query, updateDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';

const NAVY = '#0B1E2F';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';
const RED = '#CE2434';
const MUTED = '#8A98A8';

type Role = 'admin' | 'coach' | 'athlete' | 'guardian';
type User = { uid: string; email?: string; displayName?: string; role: Role };

const ROLES: Role[] = ['admin', 'coach', 'athlete', 'guardian'];

// 🔎 Construye el nombre completo desde varios campos posibles
function getFullName(u: any): string {
  const dn = (u?.displayName ?? '').toString().trim();
  const fn = (u?.fullName ?? '').toString().trim();
  const name = (u?.name ?? '').toString().trim();
  const first = (u?.firstName ?? u?.givenName ?? '').toString().trim();
  const last = (u?.lastName ?? u?.familyName ?? '').toString().trim();
  const combo = [first, last].filter(Boolean).join(' ').trim();
  return dn || fn || name || combo || '';
}

export default function RolesScreen() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'Todos' | Role>('Todos');

  // modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // ▶️ Suscripción: todos los usuarios (sin orderBy para no perder nuevos docs)
  useEffect(() => {
    const qy = query(collection(db, 'users'));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr: User[] = [];
        snap.forEach((d) => {
          const u = d.data() as any;
          arr.push({
            uid: d.id,
            email: (u.email ?? '').toString(),
            displayName: getFullName(u),
            role: ((u.role ?? 'guardian') as Role),
          });
        });

        // Orden local por nombre (fallback a email/uid)
        arr.sort((a, b) => {
          const ax = (a.displayName || a.email || a.uid || '').toLowerCase();
          const bx = (b.displayName || b.email || b.uid || '').toLowerCase();
          return ax.localeCompare(bx, 'es', { sensitivity: 'base' });
        });

        setUsers(arr);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return users.filter(u => {
      if (roleFilter !== 'Todos' && u.role !== roleFilter) return false;
      if (!t) return true;
      return (
        (u.displayName ?? '').toLowerCase().includes(t) ||
        (u.email ?? '').toLowerCase().includes(t) ||
        u.uid.toLowerCase().includes(t) ||
        u.role.toLowerCase().includes(t)
      );
    });
  }, [users, search, roleFilter]);

  const askChangeRole = (user: User) => {
    if (!isAdmin) return;
    setSelectedUser(user);
    setPickerOpen(true);
  };

  const confirmRoleChange = async (newRole: Role) => {
    if (!selectedUser) return;
    const user = selectedUser;

    if (user.uid === profile?.uid && newRole !== 'admin') {
      Alert.alert('Acción no permitida', 'No puedes quitarte el rol de administrador a ti mismo.');
      return;
    }

    Alert.alert(
      'Confirmar cambio de rol',
      `¿Cambiar el rol de "${user.displayName || user.email || user.uid}" a "${newRole}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'users', user.uid), { role: newRole });
              setPickerOpen(false);
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'No se pudo actualizar el rol');
            }
          },
        },
      ]
    );
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right']}>
        <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Roles de usuarios</Text>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
        </SafeAreaView>
        <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding: 24 }}>
          <Text style={{ color: NAVY }}>Solo el administrador puede gestionar roles.</Text>
        </View>

        <View
          pointerEvents="none"
          style={{
            position:'absolute',
            left:0, right:0, bottom:0,
            height: insets.bottom,
            backgroundColor: NAVY,
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right']}>
      {/* Header */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Roles de usuarios</Text>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {/* Filtros + búsqueda */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Text style={{ color: NAVY, fontWeight: '700', marginBottom: 6 }}>Filtrar por rol</Text>
        <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
          {(['Todos', ...ROLES] as const).map((r) => {
            const active = roleFilter === r;
            return (
              <TouchableOpacity
                key={r}
                onPress={() => setRoleFilter(r)}
                style={[
                  styles.chip,
                  { marginRight: 6, marginBottom: 6 },
                  active && styles.chipActive
                ]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{r}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={{ color: NAVY, fontWeight: '700', marginTop: 8, marginBottom: 6 }}>Buscar</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Nombre, email, UID o rol"
          placeholderTextColor={MUTED}
          style={styles.input}
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.uid}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 16 }}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <Text style={{ color: NAVY }}>Sin usuarios.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                {/* SOLO nombre y rol */}
                <Text style={{ color: NAVY, fontWeight: '800' }}>
                  {item.displayName || '—'}
                </Text>
                <Text style={{ color: MUTED, marginTop: 4 }}>
                  Rol: <Text style={{ fontWeight: '700', color: NAVY }}>{item.role}</Text>
                </Text>
              </View>

              <View style={{ alignItems:'flex-end', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => askChangeRole(item)}
                  style={styles.btnChange}
                  activeOpacity={0.9}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Cambiar rol</Text>
                </TouchableOpacity>

                {/* Botón para ir a su perfil */}
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/profile/[uid]', params: { uid: item.uid } })}

                  style={styles.btnProfile}
                  activeOpacity={0.9}
                >
                  <Text style={{ color: NAVY, fontWeight: '800' }}>Ver perfil</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Picker de rol */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPickerOpen(false)} />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Selecciona nuevo rol</Text>
          {ROLES.map((r) => (
            <TouchableOpacity key={r} onPress={() => confirmRoleChange(r)} style={styles.modalItem}>
              <Text style={styles.modalItemText}>{r}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ marginTop: 8 }}>
            <Text style={styles.modalCancel}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Franja inferior azul EXACTA al área de botones del sistema */}
      <View
        pointerEvents="none"
        style={{
          position:'absolute',
          left:0, right:0, bottom:0,
          height: insets.bottom,
          backgroundColor: NAVY,
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 44,
    paddingHorizontal: 12, backgroundColor:'#fff', color: NAVY, marginBottom: 8,
  },
  chip: {
    backgroundColor: '#EDEFF3',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: RED },
  chipText: { color: NAVY, fontWeight: '700', fontSize: 12 },
  chipTextActive: { color: '#fff', fontWeight: '800' },

  card: {
    backgroundColor:'#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection:'row',
    alignItems:'center',
  },
  btnChange: {
    backgroundColor: RED,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnProfile: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor:'#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  backdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.35)' },
  modalSheet: {
    position:'absolute',
    left:16, right:16, bottom:24,
    backgroundColor:'#fff',
    borderRadius: 12,
    borderWidth:1,
    borderColor: BORDER,
    padding: 12,
  },
  modalTitle: { color: NAVY, fontWeight:'800', marginBottom: 8 },
  modalItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  modalItemText: { color: NAVY, fontWeight: '700' },
  modalCancel: {
    color: NAVY, fontWeight:'700', textAlign:'center',
    paddingVertical:10, borderRadius:10, borderWidth:1, borderColor:BORDER, backgroundColor:'#fff',
  },
});
