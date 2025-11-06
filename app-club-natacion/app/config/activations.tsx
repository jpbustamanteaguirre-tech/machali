// app/config/activations.tsx
import { router } from 'expo-router';
import {
    arrayUnion,
    collection,
    doc,
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
import { getCategory } from '../../src/utils/category';

const NAVY = '#0B1E2F';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';
const RED = '#CE2434';
const MUTED = '#4A5A6A';
const WHITE = '#fff';

type Group = { id: string; name: string; athleteIds?: string[] };

type Athlete = {
  id: string;
  name: string;
  birth?: string;         // ISO
  birthDisplay?: string;  // DD/MM/AAAA
  gender?: string;
  rut?: string;
  rutDisplay?: string;
  seasonYear?: number;
  status?: 'pending'|'active'|'inactive';
  createdAt?: any;
};

function toTitleCase(s?: string) {
  return String(s ?? '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(w => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

function ageFromISO(iso?: string | null) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const birth = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const had =
    now.getUTCMonth() > birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  if (!had) age -= 1;
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

export default function ActivationsScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  // Estado UI (expandir, selección de grupo por atleta)
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [groupSel, setGroupSel] = useState<Record<string, string | null>>({});
  const [groupPickerFor, setGroupPickerFor] = useState<Athlete | null>(null);

  // Para evitar taps dobles
  const [busyId, setBusyId] = useState<string | null>(null);

  // Cargar atletas pendientes
  useEffect(() => {
    if (!isAdmin) {
      setAthletes([]);
      setLoading(false);
      return;
    }
    const qy = query(
      collection(db, 'athletes'),
      where('status', '==', 'pending'),
      orderBy('name', 'asc')
    );
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr: Athlete[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setAthletes(arr);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [isAdmin]);

  // Cargar grupos
  useEffect(() => {
    const q = query(collection(db, 'groups'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const arr: Group[] = [];
      snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
      setGroups(arr);
    });
    return unsub;
  }, []);

  const groupNameOf = (gid?: string | null) =>
    gid ? (groups.find(g => g.id === gid)?.name ?? '—') : 'Elegir grupo';

  const activate = async (a: Athlete) => {
    if (busyId) return;
    try {
      const gid = groupSel[a.id] ?? null;
      if (!gid) {
        Alert.alert('Grupo requerido', 'Selecciona un grupo antes de activar al atleta.');
        return;
      }
      setBusyId(a.id);

      const batch = writeBatch(db);

      // 1) atleta -> active
      batch.update(doc(db, 'athletes', a.id), {
        status: 'active',
        updatedAt: serverTimestamp(),
        approvedAt: serverTimestamp(),
      });

      // 2) agregar a la lista del grupo
      batch.update(doc(db, 'groups', gid), {
        athleteIds: arrayUnion(a.id),
      });

      await batch.commit();

      // --- Actualización optimista: quita el atleta de la lista inmediatamente ---
      setAthletes(prev => prev.filter(x => x.id !== a.id));
      setOpenMap(prev => {
        const { [a.id]: _, ...rest } = prev;
        return rest;
      });
      setGroupSel(prev => {
        const { [a.id]: _, ...rest } = prev;
        return rest;
      });

      Alert.alert('Activado', `${toTitleCase(a.name)} fue activado(a).`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo activar el perfil.');
    } finally {
      setBusyId(null);
    }
  };

  const reject = (a: Athlete) => {
    if (busyId) return;
    Alert.alert(
      'Rechazar perfil',
      `¿Seguro que deseas rechazar a ${toTitleCase(a.name)}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Rechazar',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusyId(a.id);
              await updateDoc(doc(db, 'athletes', a.id), {
                status: 'inactive',
                rejectedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });

              // --- Actualización optimista ---
              setAthletes(prev => prev.filter(x => x.id !== a.id));
              setOpenMap(prev => {
                const { [a.id]: _, ...rest } = prev;
                return rest;
              });
              setGroupSel(prev => {
                const { [a.id]: _, ...rest } = prev;
                return rest;
              });

              Alert.alert('Rechazado', 'El perfil fue marcado como inactivo.');
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'No se pudo rechazar.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const Header = (
    <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:8,bottom:8,left:8,right:8 }}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text numberOfLines={1} style={styles.headerTitle}>Activación de perfiles</Text>
        <Text style={[styles.menuIcon, { opacity: 0 }]}>☰</Text>
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
    </SafeAreaView>
  );

  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
        {Header}
        <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding: 24 }}>
          <Text style={{ color: NAVY, textAlign:'center' }}>No tienes permiso para activar perfiles.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
      {Header}

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      ) : (athletes.length === 0) ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding:24 }}>
          <Text style={{ color: NAVY }}>No hay perfiles pendientes.</Text>
        </View>
      ) : (
        <FlatList
          data={athletes}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 8 }}
          renderItem={({ item }) => {
            const expanded = !!openMap[item.id];
            const age = ageFromISO(item.birth);
            const cat = getCategory(item.birth, item.seasonYear) || '—';
            const reqDate = formatRequestDate(item.createdAt);

            return (
              <View style={styles.card}>
                {/* Cabecera: nombre + caret */}
                <TouchableOpacity
                  onPress={() => setOpenMap(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                  activeOpacity={0.9}
                  style={styles.cardHeader}
                >
                  <Text style={styles.name}>{toTitleCase(item.name)}</Text>
                  <Text style={styles.caret}>{expanded ? '▴' : '▾'}</Text>
                </TouchableOpacity>

                {expanded && (
                  <View style={{ marginTop: 6 }}>
                    <Text style={styles.meta}>Fecha de registro: {reqDate}</Text>
                    <Text style={styles.meta}>Nacimiento: {item.birthDisplay ?? '—'} {age != null ? `(${age} años)` : ''}</Text>
                    <Text style={styles.meta}>Género: {item.gender ?? '—'}</Text>
                    {item.rutDisplay || item.rut ? (
                      <Text style={styles.meta}>RUT: {item.rutDisplay ?? item.rut}</Text>
                    ) : null}
                    <Text style={styles.meta}>Temporada: {item.seasonYear ?? '—'} · Categoría: {cat}</Text>

                    {/* Selector de grupo */}
                    <View style={{ marginTop: 10 }}>
                      <Text style={[styles.meta, { marginBottom: 4 }]}>Grupo</Text>
                      <TouchableOpacity
                        onPress={() => setGroupPickerFor(item)}
                        style={styles.selectTrigger}
                        activeOpacity={0.85}
                        disabled={busyId === item.id}
                      >
                        <Text style={styles.selectText}>{groupNameOf(groupSel[item.id] ?? null)}</Text>
                        <Text style={styles.selectCaret}>▾</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Botones */}
                    <View style={{ flexDirection:'row', gap:10, marginTop: 12 }}>
                      <TouchableOpacity
                        onPress={() => activate(item)}
                        disabled={busyId === item.id}
                        style={[
                          styles.btn,
                          { backgroundColor: '#12B76A', borderColor: '#0E8C53', opacity: busyId === item.id ? 0.7 : 1 },
                        ]}
                      >
                        <Text style={styles.btnTxt}>Activar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => reject(item)}
                        disabled={busyId === item.id}
                        style={[
                          styles.btn,
                          { backgroundColor: '#F97066', borderColor: '#D92D20', opacity: busyId === item.id ? 0.7 : 1 },
                        ]}
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

      {/* Barra inferior azul SOLO hasta el área de botones del sistema */}
      <BottomInsetBar />
      
      {/* Modal de grupos */}
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
                  setGroupSel(prev => ({ ...prev, [groupPickerFor.id]: g.id }));
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

// ----- Componente barra inferior tipo index/asistencia -----
function BottomInsetBar() {
  const insets = useSafeAreaInsets();
  return (
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
  );
}

const styles = StyleSheet.create({
  // Header
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
  backText: { color:'#fff', fontSize:18, includeFontPadding: false as any },
  menuIcon: { color:'#fff', fontSize:22, fontWeight:'800', includeFontPadding: false as any },

  // Cards
  card: {
    backgroundColor: WHITE,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardHeader: { flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  name: { color: NAVY, fontWeight:'800' },
  caret: { color: '#8A98A8', fontWeight:'800' },
  meta: { color: '#4A5A6A', marginTop: 4 },

  // Botones
  btn: {
    flex:1, borderRadius:12, paddingVertical:10, alignItems:'center', borderWidth:1,
  },
  btnTxt: { color:'#fff', fontWeight:'800' },

  // Selects / Modales
  selectTrigger: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 44,
    paddingHorizontal: 12, backgroundColor:'#fff',
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
  },
  selectText: { color: NAVY, fontWeight:'700', flex:1 },
  selectCaret: { color: '#8A98A8', fontWeight:'800' },
  selectMenu: { borderWidth:1, borderColor:BORDER, borderRadius:12, backgroundColor:'#fff' },
  selectItem: {
    paddingVertical:10, paddingHorizontal:12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  selectItemText: { color: NAVY, fontWeight:'700' },

  modalBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.35)' },
  modalCard: {
    position:'absolute', left:16, right:16, top:'22%',
    backgroundColor:'#fff', borderRadius:12,
    borderWidth:1, borderColor:BORDER, padding:12,
    shadowColor:'#000', shadowOpacity:0.15, shadowRadius:12, elevation:6,
  },
  sheetTitle: { color: NAVY, fontWeight:'800', fontSize:16 },
  smallBtn: { borderRadius:10, paddingHorizontal:12, paddingVertical:10 },
});
