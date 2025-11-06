// app/profile/index.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
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

// Grid
const ROW_H = 32;
const DAY_COL_W = 34;
const MIN_GROUP_COL_W = 88;
const COL_GAP = 4;

type DayKey =
  | 'Lunes'
  | 'Martes'
  | 'Miércoles'
  | 'Jueves'
  | 'Viernes'
  | 'Sábado'
  | 'Domingo';
type TimeRange = { start: string; end: string };
type Schedule = Record<DayKey, TimeRange[]>;
type Group = {
  id: string;
  name: string;
  schedule?: Schedule;
  athleteIds?: string[];
};

const DAYS: DayKey[] = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const DAY_INIT: Record<DayKey, string> = {
  Lunes: 'L', Martes: 'M', Miércoles: 'M', Jueves: 'J', Viernes: 'V', Sábado: 'S', Domingo: 'D',
};

function toTitleCase(s?: string) {
  return String(s ?? '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}
function getAgeFromISO(iso?: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, yy, mm, dd] = m;
  const birth = new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd)));
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getUTCFullYear();
  const hadBDay =
    now.getMonth() > Number(mm) - 1 ||
    (now.getMonth() === Number(mm) - 1 && now.getDate() >= Number(dd));
  if (!hadBDay) age -= 1;
  return age;
}
function groupAbbr3(name?: string): string {
  const base = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  if (!base) return 'GRP';
  if (base.length >= 3) return base.slice(0, 3);
  return (base + base.slice(-1).repeat(3)).slice(0, 3);
}

export default function ProfileIndex() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const uid = user?.uid;
  const isCoachOrAdmin = profile?.role === 'admin' || profile?.role === 'coach';

  const [liveUser, setLiveUser] = useState<any | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);

  // === Claves de caché (dependen del usuario) ===
  const USER_CACHE_KEY = uid ? `user_${uid}_v1` : 'user_no_uid';
  const GROUPS_CACHE_KEY = uid ? `groups_assigned_${uid}_v1` : 'groups_assigned_no_uid';

  // ====== Arranque OFFLINE desde caché ======
  const [loadingUser, setLoadingUser] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const rawUser = await AsyncStorage.getItem(USER_CACHE_KEY);
        if (rawUser) setLiveUser(JSON.parse(rawUser));
      } catch {}
      setLoadingUser(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Live user doc + persistencia
  useEffect(() => {
    if (!uid) return;
    setLoadingUser((prev) => prev && true);
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      async (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setLiveUser(data);
        try { await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(data)); } catch {}
        setLoadingUser(false);
      },
      () => setLoadingUser(false)
    );
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Datos perfil derivados
  const effectivePhotoURL: string | undefined =
    (liveUser?.photoURL as string | undefined) ??
    (profile as any)?.photoURL ??
    user?.photoURL ??
    undefined;

  const birthISO: string | undefined =
    (typeof liveUser?.birth === 'string' && liveUser.birth) ||
    (typeof (profile as any)?.birth === 'string' && (profile as any).birth) ||
    undefined;

  const age = getAgeFromISO(birthISO);

  const displayName = toTitleCase(
    (liveUser?.displayName as string | undefined) ||
      profile?.displayName ||
      user?.displayName ||
      'Usuario'
  );

  const email =
    (liveUser?.email as string | undefined) ||
    user?.email ||
    (profile as any)?.email ||
    '';

  const roleLabel =
    (liveUser?.role as string | undefined) || profile?.role || '—';

  const phoneRaw =
    (liveUser?.phone as string | undefined) ||
    (profile as any)?.phone ||
    '';
  const phoneDigits =
    (liveUser?.phoneDigits as string | undefined) ||
    (profile as any)?.phoneDigits ||
    '';
  const phoneDisplay = phoneRaw || (phoneDigits ? `+56${phoneDigits}` : '');

  const courses: string[] = Array.isArray(liveUser?.courses)
    ? (liveUser!.courses as string[])
    : Array.isArray((profile as any)?.courses)
    ? ((profile as any).courses as string[])
    : [];

  // ====== Grupos asignados ======
  const [headGroups, setHeadGroups] = useState<Group[]>([]);
  const [asstGroups, setAsstGroups] = useState<Group[]>([]);

  // Cache → arranque offline
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(GROUPS_CACHE_KEY);
        if (raw) {
          const parsed: Group[] = JSON.parse(raw);
          // Los guardamos como "head" para render (se fusionan más abajo igualmente)
          setHeadGroups(parsed);
          setAsstGroups([]);
        }
      } catch {}
      setLoadingGroups(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, isCoachOrAdmin]);

  // Snapshots online + persistencia
  useEffect(() => {
    if (!uid || !isCoachOrAdmin) return;
    setLoadingGroups(true);

    const qHead = query(collection(db, 'groups'), where('headCoachId', '==', uid));
    const unHead = onSnapshot(
      qHead,
      (snap) => {
        const arr: Group[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setHeadGroups(arr);
      },
      () => setLoadingGroups(false)
    );

    const qAsst = query(collection(db, 'groups'), where('assistantCoachIds', 'array-contains', uid));
    const unAsst = onSnapshot(
      qAsst,
      async (snap) => {
        const arr: Group[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setAsstGroups(arr);
        setLoadingGroups(false);
      },
      () => setLoadingGroups(false)
    );

    return () => { unHead(); unAsst(); };
  }, [uid, isCoachOrAdmin]);

  // Fusión + persistencia única del conjunto asignado
  const groups = useMemo(() => {
    const map: Record<string, Group> = {};
    headGroups.forEach((g) => (map[g.id] = g));
    asstGroups.forEach((g) => (map[g.id] = g));
    const out = Object.values(map).sort((a, b) =>
      (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity: 'base' })
    );
    // Persistimos el conjunto unificado para offline
    (async () => {
      try { await AsyncStorage.setItem(GROUPS_CACHE_KEY, JSON.stringify(out)); } catch {}
    })();
    return out;
  }, [headGroups, asstGroups, GROUPS_CACHE_KEY]);

  // Conteos por grupo + total único asignado
  const perGroupCount = useMemo(() => {
    const m: Record<string, number> = {};
    groups.forEach((g) => (m[g.id] = g.athleteIds?.length ?? 0));
    return m;
  }, [groups]);

  const totalUniqueAssigned = useMemo(() => {
    const set = new Set<string>();
    groups.forEach((g) => (g.athleteIds ?? []).forEach((id) => set.add(id)));
    return set.size;
  }, [groups]);

  // Grid responsive
  const [gridWidth, setGridWidth] = useState(0);

  const groupColumns = useMemo(() => {
    return groups.map((g) => {
      const sch: Schedule = {
        Lunes: [], Martes: [], Miércoles: [], Jueves: [], Viernes: [], Sábado: [], Domingo: [],
        ...(g.schedule ?? {}),
      };
      const byDay: Record<DayKey, string> = {
        Lunes: (sch.Lunes ?? []).map((r) => `${r.start}–${r.end}`).join(' · '),
        Martes: (sch.Martes ?? []).map((r) => `${r.start}–${r.end}`).join(' · '),
        Miércoles: (sch.Miércoles ?? []).map((r) => `${r.start}–${r.end}`).join(' · '),
        Jueves: (sch.Jueves ?? []).map((r) => `${r.start}–${r.end}`).join(' · '),
        Viernes: (sch.Viernes ?? []).map((r) => `${r.start}–${r.end}`).join(' · '),
        Sábado: (sch.Sábado ?? []).map((r) => `${r.start}–${r.end}`).join(' · '),
        Domingo: (sch.Domingo ?? []).map((r) => `${r.start}–${r.end}`).join(' · '),
      };
      return {
        id: g.id,
        abbr: groupAbbr3(g.name),
        byDay,
        count: perGroupCount[g.id] ?? 0,
      };
    });
  }, [groups, perGroupCount]);

  const computedColWidth = useMemo(() => {
    const n = groupColumns.length;
    if (n === 0 || gridWidth <= 0) return MIN_GROUP_COL_W;
    const avail = gridWidth - DAY_COL_W - COL_GAP;
    if (avail <= 0) return MIN_GROUP_COL_W;
    const totalGaps = COL_GAP * n;
    const w = Math.floor((avail - totalGaps) / n);
    return Math.max(MIN_GROUP_COL_W, w);
  }, [gridWidth, groupColumns.length]);

  // Acciones
  const goEdit = () => {
    setMenuOpen(false);
    router.push('/profile/edit');
  };

  const isLoadingAll = loadingUser || loadingGroups;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      {/* Header */}
      <SafeAreaView
        edges={['top', 'left', 'right']}
        style={{ backgroundColor: NAVY }}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.headerRow}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Perfil</Text>
          <TouchableOpacity
            onPress={() => setMenuOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {isLoadingAll ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: Math.max(16, insets.bottom + 8) }}>
          {/* Cabecera usuario */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {effectivePhotoURL ? (
                <Image source={{ uri: effectivePhotoURL }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={{ color: NAVY, fontWeight: '900' }}>
                    {displayName.slice(0, 1)}
                  </Text>
                </View>
              )}
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={{ color: NAVY, fontWeight: '800' }}>{displayName}</Text>
                <Text style={{ color: MUTED, marginTop: 2 }} numberOfLines={1}>
                  {email || '—'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>Rol: {roleLabel}</Text>
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>
                      Edad: {age != null ? `${age}` : '—'}
                    </Text>
                  </View>
                  {phoneDisplay ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeTxt}>Tel: {phoneDisplay}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </View>

          {/* Cursos y actualizaciones */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Cursos y actualizaciones</Text>
            {courses.length === 0 ? (
              <Text style={{ color: MUTED }}>—</Text>
            ) : (
              <View style={{ gap: 6 }}>
                {courses.map((c, i) => (
                  <View
                    key={`${i}-${c}`}
                    style={{
                      borderWidth: 1,
                      borderColor: BORDER,
                      backgroundColor: '#fff',
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                    }}
                  >
                    <Text style={{ color: NAVY, fontWeight: '800' }} numberOfLines={2}>
                      {c}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Grupos asignados */}
          {groups.length > 0 ? (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.sectionTitle}>Grupos asignados</Text>
                <View style={[styles.badge, { paddingVertical: 2, paddingHorizontal: 8 }]}>
                  <Text style={[styles.badgeTxt, { fontSize: 12 }]}>
                    Total: {totalUniqueAssigned}
                  </Text>
                </View>
              </View>

              <View
                style={{ flexDirection: 'row', marginTop: 6 }}
                onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
              >
                {/* Columna de días */}
                <View style={{ width: DAY_COL_W, marginRight: COL_GAP }}>
                  <View style={[styles.gridHeaderCell, { alignItems: 'center' }]}>
                    <Text style={styles.gridHeaderTxt} />
                  </View>
                  {DAYS.map((d) => (
                    <View key={`d-${d}`} style={[styles.gridDayCell, { alignItems: 'center' }]}>
                      <Text style={styles.gridDayTxt}>{DAY_INIT[d]}</Text>
                    </View>
                  ))}
                </View>

                {/* Columnas por grupo */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row' }}>
                    {groupColumns.map((col) => (
                      <View key={col.id} style={{ width: computedColWidth, marginRight: COL_GAP }}>
                        {/* Header: 3 letras + badge con count */}
                        <View
                          style={[
                            styles.gridHeaderCell,
                            {
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              paddingHorizontal: 8,
                            },
                          ]}
                        >
                          <Text style={styles.gridHeaderTxt} numberOfLines={1}>
                            {col.abbr}
                          </Text>
                          <View style={styles.countPill}>
                            <Text style={styles.countPillTxt}>{col.count}</Text>
                          </View>
                        </View>

                        {/* Fila por día */}
                        {DAYS.map((d) => (
                          <View key={`${col.id}-${d}`} style={styles.gridCell}>
                            <Text
                              style={styles.gridCellTxt}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {col.byDay[d] || '—'}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* Menú opciones */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)} />
        <View style={[styles.menuSheet, { top: headerHeight || 64 }]}>
          <Text style={styles.menuTitle}>Opciones</Text>

          <TouchableOpacity style={styles.menuItem} onPress={goEdit}>
            <Text style={styles.menuItemText}>Editar perfil</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setMenuOpen(false)} style={{ marginTop: 10 }}>
            <Text style={styles.menuCancel}>Cancelar</Text>
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
  menuIcon: { color: '#fff', fontSize: 22, fontWeight: '800', includeFontPadding: false as any },

  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
  },

  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#DDE3EA' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },

  badge: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CHIP_BG,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  badgeTxt: { color: NAVY, fontWeight: '800', fontSize: 12 },

  sectionTitle: { color: NAVY, fontWeight: '800', marginBottom: 6, fontSize: 13 },

  gridHeaderCell: {
    height: ROW_H,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 6,
    backgroundColor: '#fff',
    justifyContent: 'center',
    marginBottom: 4,
  },
  gridHeaderTxt: { color: NAVY, fontWeight: '800', fontSize: 12 },

  gridDayCell: {
    height: ROW_H,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#FAFBFD',
    justifyContent: 'center',
    marginBottom: 4,
  },
  gridDayTxt: { color: NAVY, fontWeight: '800', fontSize: 12 },

  gridCell: {
    height: ROW_H,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 6,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  gridCellTxt: { color: NAVY, fontWeight: '800', fontSize: 11, textAlign: 'center' },

  countPill: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FAFBFD',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countPillTxt: { color: NAVY, fontWeight: '800', fontSize: 11 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  menuSheet: {
    position: 'absolute',
    right: 12,
    width: 220,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  menuTitle: { color: NAVY, fontWeight: '800', marginBottom: 8 },
  menuItem: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  menuItemText: { color: NAVY, fontWeight: '700' },
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
