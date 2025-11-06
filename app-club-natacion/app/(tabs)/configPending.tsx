// app/(tabs)/configPending.tsx
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';

const NAVY = '#0B1E2F';
const BG = '#F7F8FA';
const RED = '#CE2434';
const BORDER = '#E6E8EC';
const MUTED = '#8A98A8';
const WHITE = '#fff';

// ==== Gradiente como login ====
const GRADIENT_COLORS = ['#CE2434', '#7E1A27', '#401520', '#0B1E2F'];
const Gradient: any = LinearGradient;
const brandLogoLight = require('../../assets/images/logoblanco.png');

type Role = 'admin' | 'coach' | 'athlete' | 'guardian';

type PendingUser = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  fullName?: string | null;
  rut?: string | null;

  approved?: boolean;
  status?: 'pending'|'active'|'disabled'|'approved';

  requestedRole?: Role;     // desde el registro
  role?: Role;              // compat

  isGuardian?: boolean;
  athleteName?: string | null;
  notes?: string | null;
  birth?: string | null;    // ISO YYYY-MM-DD

  registrationAt?: any;     // Firestore Timestamp o Date
};

type Group = { id: string; name: string };

function toTitleCase(s?: string | null) {
  return String(s ?? '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(w => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}
function formatDMYFromISO(iso?: string | null) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '—';
  const [, yy, mm, dd] = m;
  return `${dd}-${mm}-${yy}`;
}
function calcAgeFromISO(iso?: string | null) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const birth = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getUTCFullYear();
  const hadBDay =
    now.getMonth() > birth.getUTCMonth() ||
    (now.getMonth() === birth.getUTCMonth() && now.getDate() >= birth.getUTCDate());
  if (!hadBDay) age -= 1;
  return age;
}
function formatRequestDate(ts?: any) {
  if (!ts) return '—';
  let d: Date | null = null;
  if (ts?.toDate) d = ts.toDate();
  else if (typeof ts?.seconds === 'number') d = new Date(ts.seconds * 1000);
  else if (typeof ts === 'string' || ts instanceof Date) d = new Date(ts);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CL', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function PendingApprovals() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [items, setItems] = useState<PendingUser[] | null>(null);
  const [loading, setLoading] = useState(true);

  // grupos para asignar si es atleta
  const [groups, setGroups] = useState<Group[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'groups'), orderBy('name', 'asc')), (snap) => {
      const arr: Group[] = [];
      snap.forEach(d => arr.push({ id: d.id, ...(d.data() as any) }));
      setGroups(arr);
    });
    return unsub;
  }, []);

  // selección local
  const [roleSel, setRoleSel] = useState<Record<string, Role>>({});
  const [groupSel, setGroupSel] = useState<Record<string, string | null>>({});

  // expand/collapse por tarjeta
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  // pickers
  const [rolePickerFor, setRolePickerFor] = useState<PendingUser | null>(null);
  const [groupPickerFor, setGroupPickerFor] = useState<PendingUser | null>(null);

  const roleLabel = (r: Role) =>
    r === 'athlete' ? 'Atleta' : r === 'guardian' ? 'Apoderado' : r === 'coach' ? 'Coach' : 'Admin';

  // ====== Listener de aprobaciones para NO admin (auto navegacion) ======
  useEffect(() => {
    if (isAdmin) return;
    try {
      const { firebaseAuth } = require('../../src/services/firebase');
      const uid: string | undefined = firebaseAuth.currentUser?.uid;
      if (!uid) return;
      const ref = doc(db, 'users', uid);
      const unsub = onSnapshot(ref, (snap) => {
        const data = snap.data() as any;
        if (data?.approved === true && (data?.status === 'active' || data?.status === 'approved')) {
          // Autorizado -> entra a tabs
          router.replace('/(tabs)');
        }
      });
      return unsub;
    } catch {
      // si algo falla, no bloqueamos la vista
      return;
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setItems([]);
      setLoading(false);
      return;
    }
    const qy = query(
      collection(db, 'users'),
      where('approved', '==', false),
      orderBy('registrationAt', 'desc')
    );
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: PendingUser[] = [];
        snap.forEach(d => rows.push({ uid: d.id, ...(d.data() as any) }));
        setItems(rows);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        Alert.alert('Permisos', err?.message ?? 'No se pudieron obtener las solicitudes.');
      }
    );
    return unsub;
  }, [isAdmin]);

  const getSelectedRole = (u: PendingUser): Role =>
    roleSel[u.uid] ?? u.requestedRole ?? u.role ?? (u.isGuardian ? 'guardian' : 'athlete');

  const getSelectedGroupName = (u: PendingUser) => {
    const gid = groupSel[u.uid] ?? null;
    if (!gid) return 'Elegir grupo';
    return groups.find(g => g.id === gid)?.name ?? 'Elegir grupo';
  };

  const approve = async (u: PendingUser) => {
    try {
      const selRole = getSelectedRole(u);
      if (selRole === 'athlete') {
        const gid = groupSel[u.uid] ?? null;
        if (!gid) {
          Alert.alert('Grupo requerido', 'Selecciona un grupo para el atleta.');
          return;
        }
      }

      const batch = writeBatch(db);

      // Guardar SIEMPRE el rol ASIGNADO acá
      batch.update(doc(db, 'users', u.uid), {
        approved: true,
        status: 'active',
        role: selRole,
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (selRole === 'athlete') {
        const gid = groupSel[u.uid]!;
        // nombre y fecha para ficha
        const userSnap = await getDoc(doc(db, 'users', u.uid));
        const udata = userSnap.exists() ? (userSnap.data() as any) : {};
        const displayName = toTitleCase(udata.fullName || u.fullName || u.displayName || u.email || 'Nadador');
        const birthISO = (udata.birth as string | undefined) || u.birth || null;

        // crear ficha atleta
        const athleteRef = doc(collection(db, 'athletes'));
        batch.set(athleteRef, {
          name: displayName,
          userUid: u.uid,
          birth: birthISO || null,
          status: 'active',
          createdAt: serverTimestamp(),
        });

        // añadir al grupo
        batch.update(doc(db, 'groups', gid), {
          athleteIds: arrayUnion(athleteRef.id),
        });
      }

      await batch.commit();
      Alert.alert('Aprobado', `Se aprobó a ${toTitleCase(u.fullName || u.displayName || u.email)}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo aprobar.');
    }
  };

  const reject = (u: PendingUser) => {
    Alert.alert(
      'Rechazar solicitud',
      `¿Seguro que deseas rechazar a ${toTitleCase(u.fullName || u.displayName || u.email)}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Rechazar',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'users', u.uid), {
                approved: false,
                status: 'disabled',
                rejectedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              Alert.alert('Rechazado', 'Solicitud rechazada.');
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'No se pudo rechazar.');
            }
          },
        },
      ]
    );
  };

  const TitleBar = (
    <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
          <Text style={{ color:'#fff', fontSize:18 }}>←</Text>
        </TouchableOpacity>
        <Text numberOfLines={1} style={styles.headerTitle}>Solicitudes de acceso</Text>
        <Text style={{ color:'#fff', fontSize:22, fontWeight:'800', opacity:0 }}>☰</Text>
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
    </SafeAreaView>
  );

  // ======== Vista para NO admin: pantalla de espera con mismo degradado que login ========
  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top','left','right','bottom']}>
        <Gradient
          colors={GRADIENT_COLORS}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Image
            source={brandLogoLight}
            style={{ width: 120, height: 120, marginBottom: 12 }}
            resizeMode="contain"
          />
          <Text style={g.brand}>Solicitud en curso</Text>
          <Text style={g.subtitle}>
            Tu solicitud está siendo revisada por el equipo. Te avisaremos cuando sea aprobada.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
      {TitleBar}

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      ) : (items?.length ?? 0) === 0 ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding:24 }}>
          <Text style={{ color: NAVY }}>No hay solicitudes pendientes.</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{ padding:16, paddingBottom: insets.bottom + 12 }}
          data={items!}
          keyExtractor={(it) => it.uid}
          renderItem={({ item }) => {
            const expanded = !!openMap[item.uid];
            const selRole = getSelectedRole(item);
            const showGroup = selRole === 'athlete';

            const name = toTitleCase(item.fullName || item.displayName || '—');
            const rolSolicitado = item.requestedRole ?? item.role ?? (item.isGuardian ? 'guardian' : 'athlete');
            const age = calcAgeFromISO(item.birth);
            const reqDate = formatRequestDate(item.registrationAt);

            return (
              <View style={styles.card}>
                {/* Cabecera: SOLO Nombre + caret */}
                <TouchableOpacity
                  onPress={() => setOpenMap(prev => ({ ...prev, [item.uid]: !prev[item.uid] }))}
                  activeOpacity={0.9}
                  style={styles.cardHeader}
                >
                  <Text style={styles.name}>{name}</Text>
                  <Text style={styles.caret}>{expanded ? '▴' : '▾'}</Text>
                </TouchableOpacity>

                {/* Cuerpo expandible con todos los datos */}
                {expanded && (
                  <View style={{ marginTop: 6 }}>
                    <Text style={styles.meta}>Fecha de solicitud: {reqDate}</Text>
                    {item.email ? <Text style={styles.meta}>Email: {item.email}</Text> : null}
                    {item.rut ? <Text style={styles.meta}>RUT: {item.rut}</Text> : null}
                    <Text style={styles.meta}>Rol solicitado: {roleLabel(rolSolicitado as Role)}</Text>
                    <Text style={styles.meta}>Apoderado: {item.isGuardian ? 'Sí' : 'No'}</Text>
                    {item.athleteName ? <Text style={styles.meta}>Nadador: {toTitleCase(item.athleteName)}</Text> : null}
                    {item.birth ? (
                      <Text style={styles.meta}>
                        Nacimiento: {formatDMYFromISO(item.birth)} {age != null ? `(${age} años)` : ''}
                      </Text>
                    ) : null}
                    {item.notes ? <Text style={styles.meta}>Notas: {item.notes}</Text> : null}

                    {/* Selector de rol */}
                    <View style={{ marginTop:10 }}>
                      <Text style={[styles.meta, { marginBottom: 4 }]}>Rol a asignar</Text>
                      <TouchableOpacity
                        onPress={() => setRolePickerFor(item)}
                        style={styles.selectTrigger}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.selectText}>{roleLabel(selRole)}</Text>
                        <Text style={styles.selectCaret}>▾</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Selector de grupo si es atleta */}
                    {showGroup ? (
                      <View style={{ marginTop:10 }}>
                        <Text style={[styles.meta, { marginBottom: 4 }]}>Grupo del atleta</Text>
                        <TouchableOpacity
                          onPress={() => setGroupPickerFor(item)}
                          style={styles.selectTrigger}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.selectText}>{getSelectedGroupName(item)}</Text>
                          <Text style={styles.selectCaret}>▾</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    <View style={{ flexDirection:'row', gap:10, marginTop:12 }}>
                      <TouchableOpacity
                        onPress={() => approve(item)}
                        style={[styles.btn, { backgroundColor: '#12B76A', borderColor: '#0E8C53' }]}
                      >
                        <Text style={styles.btnTxt}>Aprobar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => reject(item)}
                        style={[styles.btn, { backgroundColor: '#F97066', borderColor: '#D92D20' }]}
                      >
                        <Text style={styles.btnTxt}>Rechazar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {/* ❌ Eliminado overlay inferior para igualar comportamiento del tab (sin franja propia) */}

      {/* ===== MODAL: Rol ===== */}
      <Modal
        transparent
        visible={!!rolePickerFor}
        animationType="fade"
        onRequestClose={() => setRolePickerFor(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setRolePickerFor(null)} />
        <View style={styles.modalCard}>
          <Text style={styles.sheetTitle}>Seleccionar rol</Text>
          <View style={[styles.selectMenu, { marginTop: 6 }]}>
            {(['athlete','guardian','coach','admin'] as Role[]).map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => {
                  if (!rolePickerFor) return;
                  setRoleSel(prev => ({ ...prev, [rolePickerFor.uid]: r }));
                  if (r !== 'athlete') {
                    setGroupSel(prev => {
                      const next = { ...prev };
                      delete next[rolePickerFor.uid];
                      return next;
                    });
                  }
                  setRolePickerFor(null);
                }}
                style={styles.selectItem}
              >
                <Text style={styles.selectItemText}>
                  {r === 'athlete' ? 'Atleta' : r === 'guardian' ? 'Apoderado' : r === 'coach' ? 'Coach' : 'Admin'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            onPress={() => setRolePickerFor(null)}
            style={[styles.smallBtn, { backgroundColor: MUTED, alignSelf:'flex-end', marginTop:10 }]}
          >
            <Text style={{ color:'#fff', fontWeight:'800' }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ===== MODAL: Grupo ===== */}
      <Modal
        transparent
        visible={!!groupPickerFor}
        animationType="fade"
        onRequestClose={() => setGroupPickerFor(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setGroupPickerFor(null)} />
        <View style={styles.modalCard}>
          <Text style={styles.sheetTitle}>Seleccionar grupo</Text>
          <View style={[styles.selectMenu, { marginTop: 6, maxHeight: 320 }]}>
            {groups.length === 0 ? (
              <View style={{ padding: 12 }}>
                <Text style={{ color: NAVY }}>No hay grupos.</Text>
              </View>
            ) : groups.map((g) => (
              <TouchableOpacity
                key={g.id}
                onPress={() => {
                  if (!groupPickerFor) return;
                  setGroupSel(prev => ({ ...prev, [groupPickerFor.uid]: g.id }));
                  setGroupPickerFor(null);
                }}
                style={styles.selectItem}
              >
                <Text style={styles.selectItemText}>{g.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            onPress={() => setGroupPickerFor(null)}
            style={[styles.smallBtn, { backgroundColor: MUTED, alignSelf:'flex-end', marginTop:10 }]}
          >
            <Text style={{ color:'#fff', fontWeight:'800' }}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    textAlign:'center',
    includeFontPadding: false as any,
  },
  card: {
    backgroundColor: WHITE,
    borderRadius:12,
    borderWidth:1,
    borderColor:BORDER,
    padding:12,
    marginBottom:12,
  },
  cardHeader: {
    flexDirection:'row',
    alignItems:'center',
    justifyContent:'space-between',
  },
  name: { color: NAVY, fontWeight:'800' },
  caret: { color: MUTED, fontWeight:'800' },

  meta: { color:'#4A5A6A', marginTop:4 },

  btn: {
    flex:1,
    borderRadius:12,
    paddingVertical:10,
    alignItems:'center',
    borderWidth:1,
  },
  btnTxt: { color:'#fff', fontWeight:'800' },

  // Selects / modales
  selectTrigger: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 44,
    paddingHorizontal: 12, backgroundColor:'#fff',
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
  },
  selectText: { color: NAVY, fontWeight:'700', flex:1 },
  selectCaret: { color: MUTED, fontWeight:'800' },
  selectMenu: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, backgroundColor:'#fff',
  },
  selectItem: {
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  selectItemText: { color: NAVY, fontWeight: '700' },

  modalBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.35)' },
  modalCard: {
    position:'absolute',
    left:16, right:16, top:'22%',
    backgroundColor:'#fff',
    borderRadius:12,
    borderWidth:1, borderColor:BORDER,
    padding:12,
    shadowColor:'#000', shadowOpacity:0.15, shadowRadius:12, elevation:6,
  },
  sheetTitle: { color: NAVY, fontWeight:'800', fontSize:16, marginBottom: 8 },
  smallBtn: { borderRadius:10, paddingHorizontal:12, paddingVertical:10 },
});

const g = StyleSheet.create({
  brand: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 22,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.9)',
    marginTop: 8,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
