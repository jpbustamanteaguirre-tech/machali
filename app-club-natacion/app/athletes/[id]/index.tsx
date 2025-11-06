// app/athletes/[id].tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as NavigationBar from 'expo-navigation-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../../src/services/firebase';
import { useAuth } from '../../../src/stores/authStore';
import { getCategory } from '../../../src/utils/category';

const BG = '#F7F8FA';
const NAVY = '#0B1E2F';
const BORDER = '#E6E8EC';
const MUTED = '#4A5A6A';
const GREEN = '#0E7A3E';
const AMBER = '#B85C00';

// ==== Claves de caché por atleta ====
const K_ATH = (id: string) => `athlete_doc_v1:${id}`;
const K_BESTS = (id: string) => `athlete_bests_v1:${id}`;
const K_GROUP = (id: string) => `athlete_group_v1:${id}`;

type Athlete = {
  id: string;
  name: string;
  birth?: string;         // ISO YYYY-MM-DD
  birthDisplay?: string;  // DD/MM/AAAA
  rut?: string;           // guardado "11111111-1"
  rutDisplay?: string;    // "11.111.111-1"
  gender?: string;
  seasonYear?: number;
  photoURL?: string | null;
};

type ResultDoc = {
  style: string;
  distance: number;
  timeMs?: number;
  timeStr?: string;
  eventId?: string;
  eventName?: string;
  dateDisplay?: string;
};

const toTitleCase = (input: string) =>
  (input || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function isoToDDMMYYYY(iso?: string) {
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const [, y, mm, dd] = m;
  return `${dd}/${mm}/${y}`;
}

function formatRutDisplay(r?: string) {
  if (!r) return undefined;
  const clean = String(r).replace(/\./g, '').toUpperCase();
  const m = clean.match(/^(\d+)-?([\dK])$/i);
  if (!m) return r;
  const cuerpo = m[1];
  const dv = m[2].toUpperCase();
  const cuerpoFmt = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpoFmt}-${dv}`;
}

function getAgeFromISO(iso?: string): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [_, y, mo, d] = m;
  const birthDate = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (isNaN(birthDate.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - birthDate.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > (Number(mo) - 1) ||
    (now.getMonth() === (Number(mo) - 1) && now.getDate() >= Number(d));
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function isBirthdayToday(iso?: string): boolean {
  if (!iso) return false;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, _y, mo, d] = m;
  const now = new Date();
  const mmNow = String(now.getMonth() + 1).padStart(2, '0');
  const ddNow = String(now.getDate()).padStart(2, '0');
  return mo === mmNow && d === ddNow;
}

function msToTimeStr(ms?: number, fallback?: string) {
  if (typeof ms !== 'number' || isNaN(ms)) return fallback ?? '—';
  const total = Math.max(0, Math.round(ms));
  const cent = Math.floor((total % 1000) / 10);
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const cc = String(cent).toString().padStart(2, '0');
  return `${mm}:${ss}.${cc}`;
}

const QualBadge = ({ qualifying }: { qualifying?: boolean }) => {
  if (qualifying == null) return null;
  const color = qualifying ? GREEN : AMBER;
  const text = qualifying ? 'Válida' : 'No válida';
  const bg = qualifying ? '#E6F4EA' : '#FFF4E5';
  const border = qualifying ? '#B8E2C8' : '#FFD8A8';
  return (
    <View style={{ backgroundColor: bg, borderColor: border, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
      <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{text}</Text>
    </View>
  );
};

const BEST_FILTERS: Array<'Todas' | 'Válidas' | 'No válidas'> = ['Todas', 'Válidas', 'No válidas'];
const STYLE_ORDER = ['Libre', 'Espalda', 'Pecho', 'Mariposa', 'Combinado'];
const DIST_BY_STYLE: Record<string, number[]> = {
  Libre:   [25, 50, 100, 200, 400, 800, 1500],
  Espalda: [25, 50, 100, 200],
  Pecho:   [25, 50, 100, 200],
  Mariposa:[25, 50, 100, 200],
  Combinado: [100, 200, 400],
};
const styleRank = (style: string) => {
  const s = toTitleCase(style);
  const idx = STYLE_ORDER.indexOf(s);
  return idx === -1 ? 999 : idx;
};
const distanceRank = (style: string, distance: number) => {
  const s = toTitleCase(style);
  const arr = DIST_BY_STYLE[s] || [];
  const idx = arr.indexOf(distance);
  return idx === -1 ? 1000 + distance : idx;
};

export default function AthleteDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'coach';
  const athId = String(id || '');

  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  // mejores marcas y mapa de eventos -> qualifying (SOLO desde el evento)
  const [bests, setBests] = useState<ResultDoc[]>([]);
  const [eventQualMap, setEventQualMap] = useState<Record<string, boolean>>({});
  const [eventNameMap, setEventNameMap] = useState<Record<string, string>>({});

  // Grupo / profesor a cargo
  const [groupName, setGroupName] = useState<string | null>(null);
  const [coachName, setCoachName] = useState<string | null>(null);

  // Filtro (chips)
  const [bestFilter, setBestFilter] = useState<'Todas' | 'Válidas' | 'No válidas'>('Todas');

  // Altura del header
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = (e: LayoutChangeEvent) => setHeaderHeight(e.nativeEvent.layout.height);

  // Debounced save para no sobrescribir demasiado
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = (key: string, value: any) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
    }, 300);
  };

  // ====== HIDRATACIÓN INICIAL DESDE CACHÉ ======
  useEffect(() => {
    (async () => {
      try {
        const [aRaw, bRaw, gRaw] = await Promise.all([
          AsyncStorage.getItem(K_ATH(athId)),
          AsyncStorage.getItem(K_BESTS(athId)),
          AsyncStorage.getItem(K_GROUP(athId)),
        ]);
        if (aRaw) setAthlete(JSON.parse(aRaw));
        if (bRaw) setBests(JSON.parse(bRaw));
        if (gRaw) {
          const g = JSON.parse(gRaw);
          setGroupName(g?.groupName ?? null);
          setCoachName(g?.coachName ?? null);
        }
        setLoading(false);
      } catch {
        setLoading(false);
      }
    })();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [athId]);

  // Android nav bar
  useEffect(() => {
    NavigationBar.setBackgroundColorAsync(NAVY);
    NavigationBar.setButtonStyleAsync('light');
    NavigationBar.setVisibilityAsync('visible');
  }, []);

  // ====== Suscripción al atleta (online) + persistencia ======
  useEffect(() => {
    if (!athId) return;
    const ref = doc(db, 'athletes', athId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          Alert.alert('Ups', 'Nadador no encontrado');
          router.back();
          return;
        }
        const raw = snap.data() as any;
        const data: Athlete = { id: snap.id, ...raw };
        data.name = toTitleCase(data.name || 'Nadador');
        setAthlete(data);
        setLoading(false);
        debouncedSave(K_ATH(athId), data);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [athId]);

  // ====== Detectar grupo y profesor a cargo (online) + persistencia ======
  useEffect(() => {
    if (!athId) return;
    const qy = query(collection(db, 'groups'), where('athleteIds', 'array-contains', athId));
    const unsub = onSnapshot(qy, async (snap) => {
      const first = snap.docs[0];
      if (!first) {
        setGroupName(null);
        setCoachName(null);
        debouncedSave(K_GROUP(athId), { groupName: null, coachName: null });
        return;
      }
      const g = first.data() as any;
      const gName = g?.name ?? null;

      const headCoachId = g?.headCoachId as string | undefined;
      let cName: string | null = null;
      if (headCoachId) {
        try {
          const u = await getDoc(doc(db, 'users', headCoachId));
          cName = toTitleCase((u.data() as any)?.displayName ?? '');
        } catch {
          cName = null;
        }
      }
      setGroupName(gName);
      setCoachName(cName);
      debouncedSave(K_GROUP(athId), { groupName: gName, coachName: cName });
    });
    return unsub;
  }, [athId]);

  // ====== Suscribir eventos -> qualifying y nombre (no es crítico cachear; se resuelve al vuelo) ======
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'events'), (snap) => {
      const mapQ: Record<string, boolean> = {};
      const mapN: Record<string, string> = {};
      snap.forEach((d) => {
        const ev = d.data() as any;
        mapQ[d.id] = !!ev?.qualifying;
        mapN[d.id] = toTitleCase(ev?.name || '');
      });
      setEventQualMap(mapQ);
      setEventNameMap(mapN);
    });
    return unsub;
  }, []);

  // ====== Cargar y calcular mejores marcas (por estilo+distancia, menor tiempo) + persistencia ======
  useEffect(() => {
    if (!athId) return;
    const qy = query(
      collection(db, 'results'),
      where('athleteId', '==', athId),
      orderBy('distance', 'asc'),
      orderBy('style', 'asc'),
      orderBy('timeMs', 'asc')
    );

    const unsub = onSnapshot(qy, (snap) => {
      const bestMap = new Map<string, ResultDoc>(); // key = style|distance
      snap.forEach((d) => {
        const r = d.data() as any as ResultDoc;
        const key = `${toTitleCase(r.style)}|${r.distance}`;
        const prev = bestMap.get(key);
        const currTime = typeof r.timeMs === 'number' ? r.timeMs : Number.POSITIVE_INFINITY;
        const prevTime = typeof prev?.timeMs === 'number' ? prev.timeMs : Number.POSITIVE_INFINITY;
        if (!prev || currTime < prevTime) bestMap.set(key, { ...r, style: toTitleCase(r.style) });
      });

      // Orden personalizado: estilo -> distancia
      const arr = Array.from(bestMap.values()).sort((a, b) => {
        const sA = styleRank(a.style);
        const sB = styleRank(b.style);
        if (sA !== sB) return sA - sB;
        const dA = distanceRank(a.style, a.distance);
        const dB = distanceRank(b.style, b.distance);
        if (dA !== dB) return dA - dB;
        const tA = typeof a.timeMs === 'number' ? a.timeMs : Number.POSITIVE_INFINITY;
        const tB = typeof b.timeMs === 'number' ? b.timeMs : Number.POSITIVE_INFINITY;
        return tA - tB;
      });

      setBests(arr);
      debouncedSave(K_BESTS(athId), arr);
    });

    return unsub;
  }, [athId]);

  // Derivados
  const edadReal = useMemo(() => getAgeFromISO(athlete?.birth), [athlete?.birth]);
  const categoria = useMemo(() => getCategory(athlete?.birth, athlete?.seasonYear) || '—', [athlete?.birth, athlete?.seasonYear]);
  const birthdayToday = useMemo(() => isBirthdayToday(athlete?.birth), [athlete?.birth]);

  // Única fuente de verdad: validez definida por el evento
  const getQualForResult = (r: ResultDoc): boolean | undefined => {
    if (!r.eventId) return undefined;
    return eventQualMap[r.eventId] ?? false;
  };

  // Filtro por válidas/no válidas (usando SOLO el evento)
  const filteredBests = useMemo(() => {
    return bests.filter((r) => {
      const qual = getQualForResult(r);
      if (bestFilter === 'Todas') return true;
      if (bestFilter === 'Válidas') return qual === true;
      return qual === false;
    });
  }, [bests, eventQualMap, bestFilter]);

  // Iniciales para avatar
  const initials = useMemo(() => {
    const n = toTitleCase(athlete?.name ?? '');
    const parts = n.split(' ').filter(Boolean);
    const i1 = parts[0]?.[0] ?? '';
    const i2 = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (i1 + i2).toUpperCase();
  }, [athlete?.name]);

  const birthDisplay = athlete?.birthDisplay || isoToDDMMYYYY(athlete?.birth) || '-';
  const rutDisplay = athlete?.rutDisplay || formatRutDisplay(athlete?.rut) || '-';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right']}>
      {/* Header NAVY unificado */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }} onLayout={onHeaderLayout}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>
            {athlete?.name || 'Nadador'}
          </Text>
          <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {loading || !athlete ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <Text style={{ color: NAVY }}>Cargando…</Text>
        </View>
      ) : (
        <FlatList
          data={filteredBests}
          keyExtractor={(i, idx) => `${i.style}|${i.distance}|${idx}`}
          ListHeaderComponent={
            <View style={{ padding: 16 }}>
              {/* Card info */}
              <View style={styles.infoCard}>
                {/* Columna izquierda (foto) */}
                <View style={styles.infoColLeft}>
                  {athlete.photoURL ? (
                    <Image source={{ uri: athlete.photoURL }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                      <Text style={styles.avatarInitials}>{initials || 'N'}</Text>
                    </View>
                  )}
                </View>

                {/* Columna derecha (info) */}
                <View style={styles.infoColRight}>
                  {birthdayToday && (
                    <View style={styles.badgeBday}>
                      <Text style={styles.badgeBdayTxt}>🎂 Cumpleaños hoy</Text>
                    </View>
                  )}

                  {/* ORDEN: RUT, Nacimiento, Edad, Género, Grupo, Profesor, Categoría */}
                  <Text style={{ color: MUTED }}>RUT: {rutDisplay}</Text>
                  <Text style={{ color: MUTED }}>Nacimiento: {birthDisplay}</Text>
                  <Text style={{ color: MUTED }}>Edad: {edadReal ?? '-'}</Text>
                  <Text style={{ color: MUTED }}>Género: {athlete.gender ?? '-'}</Text>
                  <Text style={{ color: MUTED }}>Grupo: {groupName ?? '—'}</Text>
                  <Text style={{ color: MUTED }}>Profesor a cargo: {coachName ?? '—'}</Text>
                  <Text style={styles.categoryStrong}>Categoría: {categoria}</Text>
                  <Text style={{ color: MUTED }}>Temporada: {athlete.seasonYear ?? '-'}</Text>
                </View>
              </View>

              {/* Subtítulo */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Mejores marcas históricas</Text>
              </View>

              {/* Filtro: chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                <View style={{ flexDirection:'row' }}>
                  {BEST_FILTERS.map(opt => {
                    const active = bestFilter === opt;
                    return (
                      <TouchableOpacity
                        key={opt}
                        onPress={() => setBestFilter(opt)}
                        activeOpacity={0.9}
                        style={[styles.chip, active && styles.chipOn]}
                      >
                        <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>{opt}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <View style={[styles.emptyCard, { marginTop: 10, display: filteredBests.length ? 'none' : 'flex' }]}>
                <Text style={{ color: MUTED }}>No hay marcas en esta vista.</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const qualifying = getQualForResult(item);
            return (
              <View style={styles.recordCard}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
                    <Text style={styles.recordTitle}>
                      {item.distance} m · {toTitleCase(item.style)}
                    </Text>
                    <QualBadge qualifying={qualifying} />
                  </View>
                  <Text style={styles.recordSub}>
                    {(item.eventId ? (eventNameMap[item.eventId] ?? toTitleCase(item.eventName ?? '—')) : toTitleCase(item.eventName ?? '—'))}
                    {item.dateDisplay ? ` · ${item.dateDisplay}` : ''}
                  </Text>
                </View>
                <Text style={styles.recordTime}>{msToTimeStr(item.timeMs, item.timeStr)}</Text>
              </View>
            );
          }}
          contentContainerStyle={{ paddingBottom: Math.max(8, insets.bottom) }}
        />
      )}

      {/* Menú acciones */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)} />
        <View style={[styles.menuSheet, { top: headerHeight || 64 }]}>
          <Text style={styles.menuTitle}>Acciones</Text>

          {/* Ver progreso */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              router.push({ pathname: '/athletes/[id]/progress', params: { id: String(id) } });
            }}
          >
            <Text style={styles.menuItemText}>Ver progreso</Text>
          </TouchableOpacity>

          {/* Ver tiempos */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuOpen(false);
              router.push({ pathname: '/athletes/[id]/times', params: { id: String(id) } });
            }}
          >
            <Text style={styles.menuItemText}>Ver tiempos</Text>
          </TouchableOpacity>

          {/* Editar perfil (solo admin/coach) */}
          {canEdit && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                router.push({ pathname: '/athletes/[id]/edit', params: { id: String(id) } });
              }}
            >
              <Text style={styles.menuItemText}>Editar perfil</Text>
            </TouchableOpacity>
          )}

          {/* Cancelar */}
          <TouchableOpacity onPress={() => setMenuOpen(false)} style={{ marginTop: 10 }}>
            <Text style={styles.menuCancel}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Overlay inferior EXACTO al inset del sistema */}
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

  // Card elegante 2 columnas
  infoCard: {
    backgroundColor:'#fff',
    borderRadius:12,
    borderWidth:1,
    borderColor:BORDER,
    padding:12,
    flexDirection:'row',
    alignItems:'center',
    shadowColor:'#000',
    shadowOpacity:0.08,
    shadowRadius:8,
    elevation:2,
  },
  infoColLeft: {
    width: '50%',
    alignItems:'center',
    justifyContent:'center',
    paddingRight: 8,
  },
  infoColRight: {
    width: '50%',
    paddingLeft: 8,
  },

  // Avatar
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#DDE3EA' },
  avatarFallback: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#DDE3EA', alignItems:'center', justifyContent:'center' },
  avatarInitials: { color: NAVY, fontWeight:'900', fontSize: 26 },

  // Badge cumpleaños
  badgeBday: {
    alignSelf:'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFD8A8',
    backgroundColor: '#FFF4E5',
    marginBottom: 6,
  },
  badgeBdayTxt: { color: '#B85C00', fontWeight: '800', fontSize: 12 },

  // Subtítulo
  sectionHeader: { marginTop: 12, marginBottom: 6 },
  sectionTitle: { color: NAVY, fontWeight:'800', fontSize: 16 },

  // Chips filtro
  chip: {
    borderWidth:1,
    borderColor:BORDER,
    backgroundColor:'#fff',
    paddingHorizontal:12,
    paddingVertical:8,
    borderRadius:16,
    marginRight:8,
  },
  chipOn: {
    backgroundColor:'#EDEFF3',
    borderColor:'#D3D9E0',
  },
  chipTxt: { color: NAVY, fontWeight:'700' },
  chipTxtOn: { color: NAVY, fontWeight:'800' },

  // Lista de récords
  recordCard: {
    backgroundColor:'#fff',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection:'row',
    alignItems:'center',
  },
  recordTitle: { color: NAVY, fontWeight:'800', paddingRight: 8, flexShrink: 1 },
  recordSub: { color: MUTED, marginTop: 2 },
  recordTime: { color: NAVY, fontWeight:'900', fontSize: 16, marginLeft: 10 },

  emptyCard: {
    backgroundColor:'#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },

  // Resalte categoría
  categoryStrong: { color: NAVY, fontWeight: '900', marginTop: 2 },

  // Menú modal
  modalBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.35)' },
  menuSheet: {
    position:'absolute',
    right:12,
    width:260,
    backgroundColor:'#fff',
    borderRadius:12,
    borderWidth:1,
    borderColor:BORDER,
    padding:10,
    shadowColor:'#000',
    shadowOpacity:0.15,
    shadowRadius:12,
    elevation:6,
  },
  menuTitle: { color: NAVY, fontWeight:'800', marginBottom:8 },
  menuItem: { paddingVertical:10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  menuItemText: { color: NAVY, fontWeight: '700' },
  menuCancel: {
    color: NAVY, fontWeight:'700', textAlign:'center', paddingVertical:10,
    borderRadius:10, borderWidth:1, borderColor:BORDER, backgroundColor:'#fff',
  },
});
