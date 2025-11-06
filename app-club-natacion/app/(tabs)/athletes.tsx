// app/(tabs)/athletes.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';
import { CATEGORY_OPTIONS, getCategory } from '../../src/utils/category';

const BG = '#F7F8FA';
const NAVY = '#0B1E2F';
const RED = '#CE2434';
const BORDER = '#E6E8EC';
const MUTED = '#4A5A6A';

type Group = { id: string; name: string; athleteIds?: string[] };

type Athlete = {
  id: string;
  name: string;
  birth?: string;         // ISO YYYY-MM-DD
  birthDisplay?: string;  // DD/MM/AAAA
  gender?: string;
  status?: 'pending' | 'active' | 'inactive';
  seasonYear?: number;
  photoURL?: string | null;
};

const CACHE_ATHLETES_KEY = 'athletes_cache_v1';
const FILTERS_KEY = 'athletes_filters_v1';

// Helpers
function normalizeText(s?: string) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const toTitleCase = (s: string) =>
  (s || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');

function getAgeFromISO(iso?: string): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [_, yy, mm, dd] = m;
  const birth = new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd)));
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const hasHadBirthday =
    now.getUTCMonth() > birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  if (!hasHadBirthday) age -= 1;
  return age;
}
function isBirthdayToday(iso?: string): boolean {
  if (!iso) return false;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, _y, mo, d] = m;
  const now = new Date();
  const mmNow = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ddNow = String(now.getUTCDate()).padStart(2, '0');
  return mo === mmNow && d === ddNow;
}

// Dropdown simple
function Dropdown({
  label,
  value,
  options,
  open,
  setOpen,
  onSelect,
}: {
  label: string;
  value: string;
  options: string[];
  open: boolean;
  setOpen: (v: boolean) => void;
  onSelect: (v: string) => void;
}) {
  return (
    <>
      {label ? <Text style={styles.filterLabel}>{label}</Text> : null}
      <TouchableOpacity onPress={() => setOpen(true)} activeOpacity={0.8} style={styles.dropdownTrigger}>
        <Text style={styles.dropdownText} numberOfLines={1}>{value}</Text>
        <Text style={styles.dropdownCaret}>▾</Text>
      </TouchableOpacity>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
        <View style={styles.modalCenter}>
          <View style={styles.dropdownCard}>
            <FlatList
              data={options}
              keyExtractor={(i) => i}
              renderItem={({ item }) => {
                const active = item === value;
                return (
                  <TouchableOpacity
                    onPress={() => { onSelect(item); setOpen(false); }}
                    style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                  >
                    <Text style={[styles.dropdownItemText, active && styles.dropdownItemTextActive]}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function AthletesTab() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const canCreate = profile?.role === 'admin' || profile?.role === 'coach';

  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  // Filtros persistentes
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [search, setSearch] = useState('');        // Nombre
  const [cat, setCat] = useState<string>('Todas'); // Categoría
  const [groupName, setGroupName] = useState<string>('Todos'); // Grupo

  const [openCat, setOpenCat] = useState(false);
  const [openGroup, setOpenGroup] = useState(false);

  // 1) Carga inicial desde caché (offline)
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_ATHLETES_KEY);
        if (raw) {
          const arr = JSON.parse(raw) as Athlete[];
          const norm = arr
            .filter((a) => a?.status !== 'inactive')
            .map((a) => ({ ...a, name: toTitleCase(a.name || ''), photoURL: a.photoURL ?? null }));
          norm.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity: 'base' }));
          setAthletes(norm);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  // 2) Snapshot online que refresca y persiste el caché
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'athletes'),
      async (snap) => {
        const arr: Athlete[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data?.status === 'inactive') return;
          arr.push({
            id: d.id,
            ...data,
            name: toTitleCase(data?.name || ''),
            photoURL: data?.photoURL ?? null,
          });
        });
        arr.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity: 'base' }));
        setAthletes(arr);
        try { await AsyncStorage.setItem(CACHE_ATHLETES_KEY, JSON.stringify(arr)); } catch {}
      },
      () => {}
    );
    return unsub;
  }, []);

  // 3) Grupos
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'groups'), (snap) => {
      const arr: Group[] = [];
      snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
      arr.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity: 'base' }));
      setGroups(arr);
    });
    return unsub;
  }, []);

  // 4) Filtros persistentes
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(FILTERS_KEY);
        if (raw) {
          const obj = JSON.parse(raw);
          if (typeof obj.search === 'string') setSearch(obj.search);
          if (typeof obj.cat === 'string') setCat(obj.cat);
          if (typeof obj.groupName === 'string') setGroupName(obj.groupName);
          if (typeof obj.filtersOpen === 'boolean') setFiltersOpen(obj.filtersOpen);
        }
      } catch {}
    })();
  }, []);
  useEffect(() => {
    AsyncStorage.setItem(FILTERS_KEY, JSON.stringify({ search, cat, groupName, filtersOpen })).catch(() => {});
  }, [search, cat, groupName, filtersOpen]);

  // Opciones dropdown
  const catOptions = useMemo(() => ['Todas', ...CATEGORY_OPTIONS], []);
  const groupOptions = useMemo(() => ['Todos', ...groups.map((g) => g.name)], [groups]);

  // Filtro final
  const filtered = useMemo(() => {
    const t = normalizeText(search);
    const selectedGroup = groupName === 'Todos' ? null : groups.find((g) => g.name === groupName);
    return athletes.filter((a) => {
      if (selectedGroup && !(selectedGroup.athleteIds ?? []).includes(a.id)) return false;
      const effectiveCat = getCategory(a.birth, a.seasonYear) || '—';
      if (cat !== 'Todas' && effectiveCat !== cat) return false;
      if (t && !normalizeText(a.name).includes(t)) return false;
      return true;
    });
  }, [athletes, groups, groupName, cat, search]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      {/* Header NAVY unificado */}
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: NAVY }}>
        <View style={styles.headerRow}>
          <Text style={[styles.backText, { opacity: 0 }]}>←</Text>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>Nadadores</Text>
          <Text style={[styles.menuIcon, { opacity: 0 }]}>☰</Text>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <>
          <FlatList
            data={filtered}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
            ListHeaderComponent={
              <View>
                {/* === BARRA DE FILTROS SUPERIOR (una sola fila, 3 columnas) === */}
                <View style={styles.filterBarRow}>
                  {/* Nombre */}
                  <View style={styles.filterCol}>
                    <TextInput
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Nombre"
                      placeholderTextColor="#8A98A8"
                      style={styles.input}
                      returnKeyType="search"
                    />
                  </View>

                  {/* Categoría */}
                  <View style={styles.filterCol}>
                    <Dropdown
                      label="Categoría"
                      value={cat}
                      options={catOptions}
                      open={openCat}
                      setOpen={setOpenCat}
                      onSelect={setCat}
                    />
                  </View>

                  {/* Grupo */}
                  <View style={styles.filterCol}>
                    <Dropdown
                      label="Grupo"
                      value={groupName}
                      options={groupOptions}
                      open={openGroup}
                      setOpen={setOpenGroup}
                      onSelect={setGroupName}
                    />
                  </View>
                </View>
              </View>
            }
            renderItem={({ item }) => {
              const age = getAgeFromISO(item.birth);
              const catEff = getCategory(item.birth, item.seasonYear) || '—';
              const birthday = isBirthdayToday(item.birth);
              const initial = (item.name || 'N').trim().slice(0, 1).toUpperCase();

              return (
                <TouchableOpacity
                  onPress={() => router.push(`/athletes/${item.id}`)}
                  style={[styles.card, birthday && styles.cardBirthday]}
                  activeOpacity={0.85}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {/* Avatar */}
                    {item.photoURL ? (
                      <Image source={{ uri: item.photoURL }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarFallback]}>
                        <Text style={{ color: NAVY, fontWeight: '900' }}>{initial}</Text>
                      </View>
                    )}

                    {/* Texto */}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.name}>{toTitleCase(item.name)}</Text>
                        {birthday && (
                          <View style={styles.badgeBday}>
                            <Text style={styles.badgeBdayTxt}>🎂 Hoy</Text>
                          </View>
                        )}
                      </View>

                      <Text style={styles.sub1}>
                        {age != null ? `${age} años` : '—'} · {catEff}
                      </Text>
                      <Text style={styles.sub2}>{item.gender ?? '—'}</Text>
                      {item.status === 'pending' && (
                        <Text style={{ color: '#B85C00', marginTop: 4, fontWeight: '700' }}>
                          Pendiente de activación
                        </Text>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          {canCreate && (
            <TouchableOpacity
              onPress={() => router.push('/athletes/new')}
              style={{
                position: 'absolute',
                right: 16,
                bottom: Math.max(8, insets.bottom - 30),
                backgroundColor: RED,
                borderRadius: 28,
                paddingHorizontal: 18,
                paddingVertical: 14,
                shadowColor: '#000',
                shadowOpacity: 0.12,
                shadowRadius: 8,
                elevation: 3,
              }}
              activeOpacity={0.9}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Nuevo</Text>
            </TouchableOpacity>
          )}
        </>
      )}
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
    textAlign: 'center',
    includeFontPadding: false as any,
  },
  backText: { color: '#fff', fontSize: 18, includeFontPadding: false as any },
  menuIcon: { color: '#fff', fontSize: 22, fontWeight: '800', includeFontPadding: false as any },

  // Barra de filtros (3 columnas)
  filterBarRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    alignItems: 'center',
  },
  filterCol: { flex: 1 },

  filterLabel: { color: MUTED, fontWeight: '700', fontSize: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 12,
    color: NAVY,
    backgroundColor: '#fff',
  },

  // Dropdown
  dropdownTrigger: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownText: { color: NAVY, fontWeight: '700', flex: 1, marginRight: 8 },
  dropdownCaret: { color: '#8A98A8', fontWeight: '800' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalCenter: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  dropdownCard: {
    width: 300,
    maxHeight: 360,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  dropdownItem: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  dropdownItemActive: { backgroundColor: '#EDEFF3' },
  dropdownItemText: { color: NAVY, fontWeight: '700' },
  dropdownItemTextActive: { color: NAVY, fontWeight: '800' },

  // Card atleta
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardBirthday: { backgroundColor: '#FFF9F0', borderColor: '#FFD8A8' },

  // Avatar
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DDE3EA',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  name: { color: NAVY, fontWeight: '800', fontSize: 16, flexShrink: 1 },
  sub1: { color: MUTED, marginTop: 4, fontWeight: '700' },
  sub2: { color: '#8A98A8', marginTop: 2 },

  // Badge cumpleaños
  badgeBday: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFD8A8',
    backgroundColor: '#FFF4E5',
  },
  badgeBdayTxt: { color: '#B85C00', fontWeight: '800', fontSize: 12 },
});
