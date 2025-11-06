// app\(tabs)\results\relays.tsx
import * as NavigationBar from 'expo-navigation-bar';
import { router } from 'expo-router';
import { collection, onSnapshot } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { CATEGORY_OPTIONS as CATEGORY_OPTIONS_RAW, getCategory } from '../../src/utils/category';

const CATEGORY_OPTIONS = [...CATEGORY_OPTIONS_RAW];

const BG = '#F7F8FA';
const NAVY = '#0B1E2F';
const BORDER = '#E6E8EC';
const MUTED = '#4A5A6A';
const RED = '#CE2434';

type Athlete = {
  id: string;
  name: string;
  gender?: string;
  birth?: string;
  seasonYear?: number;
  status?: 'pending' | 'active' | 'inactive';
};

type Result = {
  id: string;
  athleteId: string;
  style: string;
  distance: number;
  timeMs?: number;
  timeStr?: string;
};

type RelayLeg = 'Espalda' | 'Pecho' | 'Mariposa' | 'Libre';
type RelayType = 'Libre' | 'Combinado';
type SexFilter = 'Masculino' | 'Femenino' | 'Mixto';
type AllLeg = RelayLeg | 'Libre';

type Candidate = Athlete & {
  bestByBase: Partial<Record<AllLeg, { timeMs: number; timeStr: string }>>;
};

type RelaySlot = { leg: RelayLeg; athleteId?: string };

const legsOrder: RelayLeg[] = ['Espalda', 'Pecho', 'Mariposa', 'Libre'];
const MAX_POOL = 16;

const DISTANCE_OPTIONS = [
  { label: '100 m (4×25)', value: 100 },
  { label: '200 m (4×50)', value: 200 },
  { label: '400 m (4×100)', value: 400 },
  { label: '800 m (4×200)', value: 800 },
];

const normalizeGender = (g?: string) => {
  const s = (g || '').trim().toLowerCase();
  if (s === 'm' || s.startsWith('masc')) return 'Masculino';
  if (s === 'f' || s.startsWith('feme')) return 'Femenino';
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};

function normalizeLeg(style?: string): AllLeg | null {
  const s = (style || '').trim().toLowerCase();
  if (s.startsWith('libre')) return 'Libre';
  if (s.startsWith('espalda')) return 'Espalda';
  if (s.startsWith('pecho')) return 'Pecho';
  if (s.startsWith('mariposa')) return 'Mariposa';
  return null;
}

function parseTimeStrToMs(t?: string): number | null {
  if (!t) return null;
  const mm = t.match(/^(\d{1,2}):(\d{2})\.(\d{2})$/);
  if (mm) {
    const m = Number(mm[1]); const s = Number(mm[2]); const cs = Number(mm[3]);
    return (m * 60 + s) * 1000 + cs * 10;
  }
  const ss = t.match(/^(\d{1,2})\.(\d{2})$/);
  if (ss) {
    const s = Number(ss[1]); const cs = Number(ss[2]);
    return s * 1000 + cs * 10;
  }
  return null;
}

function msToStr(ms?: number | null) {
  if (ms == null) return '—';
  const totalCs = Math.round(ms / 10);
  const totalS = Math.floor(totalCs / 100);
  const cs = totalCs % 100;
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function diffToStr(diffMs: number | null | undefined) {
  if (diffMs == null || !isFinite(diffMs) || diffMs <= 0) return '';
  return ` (+${(diffMs / 1000).toFixed(2)}s)`;
}

const hasBest = (c: Candidate, k: AllLeg) => !!c.bestByBase?.[k];
const getBestMs = (c: Candidate, k: AllLeg) => c.bestByBase?.[k]?.timeMs ?? null;

// ===== Dropdown simple =====
function SingleSelect({
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
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.filterBox} activeOpacity={0.85}>
        <Text style={styles.filterLabel}>{label}</Text>
        <Text style={styles.filterValue} numberOfLines={1}>{value}</Text>
      </TouchableOpacity>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{label}</Text>
          <FlatList
            data={options}
            keyExtractor={(i) => i}
            renderItem={({ item }) => {
              const active = item === value;
              return (
                <TouchableOpacity
                  onPress={() => { onSelect(item); setOpen(false); }}
                  style={[styles.optRow, active && { backgroundColor: '#EEF2F7' }]}
                  activeOpacity={0.9}
                >
                  <Text style={{ color: NAVY, fontWeight: active ? '900' as const : '700' }}>{item}</Text>
                </TouchableOpacity>
              );
            }}
          />
          <TouchableOpacity onPress={() => setOpen(false)} style={styles.modalClose}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Listo</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

// ===== MultiSelect Categorías (inline) =====
function CategoriesModal({
  open,
  setOpen,
  selected,
  onToggle,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  selected: string[];
  onToggle: (val: string) => void;
}) {
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>Categorías</Text>
        <FlatList
          data={CATEGORY_OPTIONS}
          keyExtractor={(i) => i}
          renderItem={({ item }) => {
            const on = selected.includes(item);
            return (
              <TouchableOpacity
                onPress={() => onToggle(item)}
                style={[styles.optRow, on && { backgroundColor: '#EEF2F7' }]}
                activeOpacity={0.9}
              >
                <Text style={{ color: NAVY, fontWeight: '700', flex: 1 }}>{item}</Text>
                <Text style={{ color: on ? NAVY : '#8A98A8', fontWeight: '900' }}>{on ? '✓' : '○'}</Text>
              </TouchableOpacity>
            );
          }}
        />
        <TouchableOpacity onPress={() => setOpen(false)} style={styles.modalClose}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>Listo</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ===== Modal reemplazo de atleta en una posta =====
function ReplaceModal({
  open,
  setOpen,
  data,
  onPick,
  title,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  data: Array<{ id: string; name: string; ms: number; msStr: string }>;
  onPick: (id: string) => void;
  title: string;
}) {
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>{title}</Text>
        <FlatList
          data={data}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => { onPick(item.id); setOpen(false); }}
              style={styles.optRow}
              activeOpacity={0.9}
            >
              <Text style={{ color: NAVY, fontWeight: '800', flex: 1 }}>{item.name}</Text>
              <Text style={{ color: NAVY, fontWeight: '900' }}>{item.msStr}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={{ paddingVertical: 8 }}>
              <Text style={{ color: MUTED }}>No hay candidatos disponibles con tiempo válido.</Text>
            </View>
          }
        />
        <TouchableOpacity onPress={() => setOpen(false)} style={styles.modalClose}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>Cerrar</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

export default function ResultsRelaysTab() {
  useEffect(() => {
    NavigationBar.setBackgroundColorAsync(NAVY);
    NavigationBar.setButtonStyleAsync('light');
    NavigationBar.setVisibilityAsync('visible');
  }, []);

  // Datos
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [results, setResults] = useState<Result[]>([]);

  // Filtros
  const [sex, setSex] = useState<SexFilter>('Masculino');
  const [relayType, setRelayType] = useState<RelayType>('Libre');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [distance, setDistance] = useState<number>(200);

  const [openSex, setOpenSex] = useState(false);
  const [openType, setOpenType] = useState(false);
  const [openCats, setOpenCats] = useState(false);
  const [openDist, setOpenDist] = useState(false);

  // Exclusiones globales persistentes hasta "Limpiar"
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  // Relevos y baseline
  const [relayA, setRelayA] = useState<RelaySlot[] | null>(null);
  const [relayB, setRelayB] = useState<RelaySlot[] | null>(null);
  const [relayC, setRelayC] = useState<RelaySlot[] | null>(null);
  const [baselineA, setBaselineA] = useState<number | null>(null);
  const [baselineB, setBaselineB] = useState<number | null>(null);
  const [baselineC, setBaselineC] = useState<number | null>(null);

  // Top-3 (colapsables)
  const [top3OpenA, setTop3OpenA] = useState<boolean>(false);
  const [top3OpenB, setTop3OpenB] = useState<boolean>(false);
  const [top3OpenC, setTop3OpenC] = useState<boolean>(false);
  const [top3A, setTop3A] = useState<Array<{ slots: RelaySlot[]; sumMs: number }>>([]);
  const [top3B, setTop3B] = useState<Array<{ slots: RelaySlot[]; sumMs: number }>>([]);
  const [top3C, setTop3C] = useState<Array<{ slots: RelaySlot[]; sumMs: number }>>([]);

  // Modales
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceRelay, setReplaceRelay] = useState<'A' | 'B' | 'C' | null>(null);
  const [replaceIndex, setReplaceIndex] = useState<number>(0);
  const [replaceList, setReplaceList] = useState<Array<{ id: string; name: string; ms: number; msStr: string }>>([]);
  const [replaceTitle, setReplaceTitle] = useState<string>('');

  // Suscripciones
  useEffect(() => {
    const ua = onSnapshot(
      collection(db, 'athletes'),
      (snap) => {
        const arr: Athlete[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data?.status === 'inactive') return;
          arr.push({ id: d.id, ...data });
        });
        setAthletes(arr);
        setLoading(false);
      },
      () => setLoading(false)
    );

    const ur = onSnapshot(collection(db, 'results'), (snap) => {
      const arr: Result[] = [];
      snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
      setResults(arr);
    });

    return () => { ua(); ur(); };
  }, []);

  // distancia base por posta
  const baseDistance = useMemo(() => Math.floor(distance / 4), [distance]);

  // Candidatos (filtrados por sexo/categoría + exclusiones) y mejores marcas por base
  const candidates: Candidate[] = useMemo(() => {
    const filtered = athletes.filter((a) => {
      const g = normalizeGender(a.gender);
      if (sex === 'Masculino' && g !== 'Masculino') return false;
      if (sex === 'Femenino' && g !== 'Femenino') return false;
      if (selectedCats.length > 0) {
        const c = getCategory(a.birth, a.seasonYear);
        if (!selectedCats.includes(c)) return false;
      }
      if (excludedIds.has(a.id)) return false;
      return true;
    });

    const per: Record<string, Candidate> = {};
    for (const a of filtered) per[a.id] = { ...a, bestByBase: {} };

    for (const r of results) {
      const cand = per[r.athleteId];
      if (!cand) continue;
      if (Number(r.distance) !== baseDistance) continue;

      const leg = normalizeLeg(r.style);
      if (!leg) continue;

      const ms = typeof r.timeMs === 'number' ? r.timeMs : parseTimeStrToMs(r.timeStr);
      if (ms == null) continue;

      const prev = cand.bestByBase[leg];
      if (!prev || ms < prev.timeMs) {
        cand.bestByBase[leg] = { timeMs: ms, timeStr: r.timeStr ?? msToStr(ms) };
      }
    }

    return Object.values(per).map((c) => ({ ...c, gender: normalizeGender(c.gender) }));
  }, [athletes, results, sex, selectedCats, baseDistance, excludedIds]);

  const byId = useMemo(() => {
    const map: Record<string, Candidate> = {};
    for (const c of candidates) map[c.id] = c;
    return map;
  }, [candidates]);

  // ========= Utilidades de combinaciones =========
  function capByLeg(list: Candidate[], leg: AllLeg): Candidate[] {
    return list
      .filter((c) => hasBest(c, leg))
      .sort((a, b) => (getBestMs(a, leg)! - getBestMs(b, leg)!))
      .slice(0, MAX_POOL);
  }

  function allComb4<T>(arr: T[]): T[][] {
    const out: T[][] = [];
    const n = arr.length;
    for (let i = 0; i < n - 3; i++)
      for (let j = i + 1; j < n - 2; j++)
        for (let k = j + 1; k < n - 1; k++)
          for (let l = k + 1; l < n; l++)
            out.push([arr[i], arr[j], arr[k], arr[l]]);
    return out;
  }

  const PERMS_4 = [
    [0,1,2,3],[0,1,3,2],[0,2,1,3],[0,2,3,1],[0,3,1,2],[0,3,2,1],
    [1,0,2,3],[1,0,3,2],[1,2,0,3],[1,2,3,0],[1,3,0,2],[1,3,2,0],
    [2,0,1,3],[2,0,3,1],[2,1,0,3],[2,1,3,0],[2,3,0,1],[2,3,1,0],
    [3,0,1,2],[3,0,2,1],[3,1,0,2],[3,1,2,0],[3,2,0,1],[3,2,1,0],
  ];

  function isMixedValid(team: Candidate[]): boolean {
    const men = team.filter(x => x.gender === 'Masculino').length;
    const women = team.filter(x => x.gender === 'Femenino').length;
    return men >= 2 && women >= 2;
  }

  function topKFree(pool: Candidate[], sexSel: SexFilter, k = 3): Array<{ slots: RelaySlot[]; sumMs: number }> {
    const eligible = capByLeg(pool, 'Libre');
    if (eligible.length < 4) return [];
    const ranking: Array<{ team: Candidate[]; sum: number }> = [];

    for (const combo of allComb4(eligible)) {
      if (sexSel === 'Mixto' && !isMixedValid(combo)) continue;
      const sum = combo.reduce((acc, c) => acc + (getBestMs(c, 'Libre') ?? Infinity), 0);
      if (!isFinite(sum)) continue;
      const ordered = combo.slice().sort((a,b)=>getBestMs(a,'Libre')!-getBestMs(b,'Libre')!);
      ranking.push({ team: ordered, sum });
    }

    ranking.sort((a,b)=>a.sum-b.sum);
    const take = ranking.slice(0, k);
    return take.map(({ team, sum }) => ({
      slots: legsOrder.map((leg, i) => ({ leg, athleteId: team[i].id })),
      sumMs: sum,
    }));
  }

  function topKMedley(pool: Candidate[], sexSel: SexFilter, k = 3): Array<{ slots: RelaySlot[]; sumMs: number }> {
    const e = capByLeg(pool, 'Espalda');
    const p = capByLeg(pool, 'Pecho');
    const m = capByLeg(pool, 'Mariposa');
    const l = capByLeg(pool, 'Libre');

    const ids = new Set<string>([...e, ...p, ...m, ...l].map(x => x.id));
    const base = pool.filter(c => ids.has(c.id));
    if (base.length < 4) return [];

    type Assign = { slots: RelaySlot[]; sum: number };
    const rank: Assign[] = [];

    const timesCache = new Map<string, {E:number,P:number,M:number,L:number}>();
    for (const c of base) {
      timesCache.set(c.id, {
        E: getBestMs(c, 'Espalda') ?? Infinity,
        P: getBestMs(c, 'Pecho') ?? Infinity,
        M: getBestMs(c, 'Mariposa') ?? Infinity,
        L: getBestMs(c, 'Libre') ?? Infinity,
      });
    }

    for (const combo of allComb4(base)) {
      if (sexSel === 'Mixto' && !isMixedValid(combo)) continue;

      for (const perm of PERMS_4) {
        const c0 = combo[perm[0]]; const t0 = timesCache.get(c0.id)!.E;
        const c1 = combo[perm[1]]; const t1 = timesCache.get(c1.id)!.P;
        const c2 = combo[perm[2]]; const t2 = timesCache.get(c2.id)!.M;
        const c3 = combo[perm[3]]; const t3 = timesCache.get(c3.id)!.L;

        if (!isFinite(t0) || !isFinite(t1) || !isFinite(t2) || !isFinite(t3)) continue;

        rank.push({
          slots: [
            { leg: 'Espalda',  athleteId: c0.id },
            { leg: 'Pecho',    athleteId: c1.id },
            { leg: 'Mariposa', athleteId: c2.id },
            { leg: 'Libre',    athleteId: c3.id },
          ],
          sum: t0 + t1 + t2 + t3,
        });
      }
    }

    rank.sort((a,b)=>a.sum-b.sum);
    return rank.slice(0, k).map(x=>({ slots: x.slots, sumMs: x.sum }));
  }
  // Re-construye candidatos usando un set de excluidos "ex", SIN esperar el estado.
function buildCandidates(ex: Set<string>): Candidate[] {
  const filtered = athletes.filter((a) => {
    const g = normalizeGender(a.gender);
    if (sex === 'Masculino' && g !== 'Masculino') return false;
    if (sex === 'Femenino' && g !== 'Femenino') return false;
    if (selectedCats.length > 0) {
      const c = getCategory(a.birth, a.seasonYear);
      if (!selectedCats.includes(c)) return false;
    }
    if (ex.has(a.id)) return false;
    return true;
  });

  const per: Record<string, Candidate> = {};
  for (const a of filtered) per[a.id] = { ...a, bestByBase: {} };

  for (const r of results) {
    const cand = per[r.athleteId];
    if (!cand) continue;
    if (Number(r.distance) !== baseDistance) continue;

    const leg = normalizeLeg(r.style);
    if (!leg) continue;

    const ms = typeof r.timeMs === 'number' ? r.timeMs : parseTimeStrToMs(r.timeStr);
    if (ms == null) continue;

    const prev = cand.bestByBase[leg];
    if (!prev || ms < prev.timeMs) {
      cand.bestByBase[leg] = { timeMs: ms, timeStr: r.timeStr ?? msToStr(ms) };
    }
  }

  return Object.values(per).map((c) => ({ ...c, gender: normalizeGender(c.gender) }));
}


  // ========= Cálculos principales =========
  function computeA() {
    const topA = relayType === 'Libre' ? topKFree(candidates, sex, 3) : topKMedley(candidates, sex, 3);
    const a1 = topA[0] ?? null;
    setRelayA(a1?.slots ?? null);
    setBaselineA(a1?.sumMs ?? null);
    setTop3A(topA);

    // reset posteriores
    setRelayB(null); setBaselineB(null); setTop3B([]);
    setRelayC(null); setBaselineC(null); setTop3C([]);
  }

  function computeBRespectingA() {
    if (!relayA) return;
    const usedA = new Set<string>(relayA.map(s => s.athleteId!).filter(Boolean) as string[]);
    const poolB = candidates.filter(c => !usedA.has(c.id));
    const topB = relayType === 'Libre' ? topKFree(poolB, sex, 3) : topKMedley(poolB, sex, 3);
    const b1 = topB[0] ?? null;
    setRelayB(b1?.slots ?? null);
    setBaselineB(b1?.sumMs ?? null);
    setTop3B(topB);

    // reset C
    setRelayC(null); setBaselineC(null); setTop3C([]);
  }

  function computeCRespectingAB() {
    if (!relayA || !relayB) return;
    const used = new Set<string>([
      ...relayA.map(s => s.athleteId!).filter(Boolean) as string[],
      ...relayB.map(s => s.athleteId!).filter(Boolean) as string[],
    ]);
    const poolC = candidates.filter(c => !used.has(c.id));
    const topC = relayType === 'Libre' ? topKFree(poolC, sex, 3) : topKMedley(poolC, sex, 3);
    const c1 = topC[0] ?? null;
    setRelayC(c1?.slots ?? null);
    setBaselineC(c1?.sumMs ?? null);
    setTop3C(topC);
  }

  // ========= Reemplazo manual =========
  const [replaceOpenLocal, setReplaceOpenLocal] = useState(false);
  const [replaceRelayLocal, setReplaceRelayLocal] = useState<'A' | 'B' | 'C' | null>(null);
  const [replaceIndexLocal, setReplaceIndexLocal] = useState<number>(0);
  const [replaceListLocal, setReplaceListLocal] = useState<Array<{ id: string; name: string; ms: number; msStr: string }>>([]);
  const [replaceTitleLocal, setReplaceTitleLocal] = useState<string>('');

  function openReplaceDialog(which: 'A' | 'B' | 'C', slotIndex: number) {
    const slots = which === 'A' ? relayA : which === 'B' ? relayB : relayC;
    if (!slots) return;

    const slot = slots[slotIndex];
    const required: AllLeg = relayType === 'Libre' ? 'Libre' : slot.leg;

    const usedInRelay = new Set<string>(
      slots.map(s => s.athleteId).filter(Boolean) as string[]
    );
    if (slot.athleteId) usedInRelay.delete(slot.athleteId);

    const list = candidates
      .filter(c => hasBest(c, required) && !usedInRelay.has(c.id))
      .map(c => ({
        id: c.id,
        name: c.name,
        ms: getBestMs(c, required)!,
        msStr: c.bestByBase[required]!.timeStr || msToStr(getBestMs(c, required)!),
      }))
      .sort((a,b) => a.ms - b.ms);

    setReplaceRelayLocal(which);
    setReplaceIndexLocal(slotIndex);
    setReplaceListLocal(list);
    setReplaceTitleLocal(`Reemplazar · ${relayType === 'Libre' ? `Posta ${slotIndex + 1}` : slot.leg}`);
    setReplaceOpenLocal(true);
  }

  function pickReplacement(id: string) {
    if (!replaceRelayLocal) return;
    const slots = replaceRelayLocal === 'A' ? (relayA ? [...relayA] : null)
      : replaceRelayLocal === 'B' ? (relayB ? [...relayB] : null)
      : (relayC ? [...relayC] : null);
    if (!slots) return;

    const already = new Set(slots.map(s => s.athleteId).filter(Boolean) as string[]);
    already.delete(slots[replaceIndexLocal].athleteId!);
    if (already.has(id)) return;

    slots[replaceIndexLocal] = { ...slots[replaceIndexLocal], athleteId: id };

    if (replaceRelayLocal === 'A') setRelayA(slots);
    if (replaceRelayLocal === 'B') setRelayB(slots);
    if (replaceRelayLocal === 'C') setRelayC(slots);
  }


// === Helpers de recálculo "in-place" (no tocan otros relevos) ===
function recomputeAInPlace() {
  const topA = relayType === 'Libre' ? topKFree(candidates, sex, 3) : topKMedley(candidates, sex, 3);
  const a1 = topA[0] ?? null;
  setRelayA(a1?.slots ?? null);
  setBaselineA(a1?.sumMs ?? null);
  setTop3A(topA);
}

function recomputeBInPlace() {
  if (!relayA) return; // B depende de A fijo
  const usedA = new Set<string>(relayA.map(s => s.athleteId!).filter(Boolean) as string[]);
  const poolB = candidates.filter(c => !usedA.has(c.id));
  const topB = relayType === 'Libre' ? topKFree(poolB, sex, 3) : topKMedley(poolB, sex, 3);
  const b1 = topB[0] ?? null;
  setRelayB(b1?.slots ?? null);
  setBaselineB(b1?.sumMs ?? null);
  setTop3B(topB);
}

function recomputeCInPlace() {
  if (!relayA || !relayB) return; // C depende de A y B fijos
  const used = new Set<string>([
    ...relayA.map(s => s.athleteId!).filter(Boolean) as string[],
    ...relayB.map(s => s.athleteId!).filter(Boolean) as string[],
  ]);
  const poolC = candidates.filter(c => !used.has(c.id));
  const topC = relayType === 'Libre' ? topKFree(poolC, sex, 3) : topKMedley(poolC, sex, 3);
  const c1 = topC[0] ?? null;
  setRelayC(c1?.slots ?? null);
  setBaselineC(c1?.sumMs ?? null);
  setTop3C(topC);
}

// === (–) Excluir y recalcular COMPLETAMENTE el relevo actual buscando el más rápido ===
function excludeAndRecompute(which: 'A' | 'B' | 'C', removedId?: string) {
  if (!removedId) return;

  // 1️⃣ Crear el nuevo set de excluidos
  const nextExcluded = new Set(excludedIds);
  nextExcluded.add(removedId);

  // 2️⃣ Generar candidatos filtrados con los nuevos excluidos
  const nextCandidates = buildCandidates(nextExcluded);

  // 3️⃣ Recalcular óptimo global del relevo actual, reorganizando por completo
  if (which === 'A') {
    const topA = relayType === 'Libre'
      ? topKFree(nextCandidates, sex, 3)
      : topKMedley(nextCandidates, sex, 3);

    const best = topA.length ? topA[0] : null;

    if (best) {
      setRelayA(best.slots);
      setBaselineA(best.sumMs);
      setTop3A(topA);
    } else {
      setRelayA(null);
      setBaselineA(null);
      setTop3A([]);
    }

    setExcludedIds(nextExcluded);
    return;
  }

  if (which === 'B') {
    if (!relayA) return;

    const usedA = new Set<string>(
      relayA.map(s => s.athleteId!).filter(Boolean) as string[]
    );

    const poolB = nextCandidates.filter(c => !usedA.has(c.id));

    const topB = relayType === 'Libre'
      ? topKFree(poolB, sex, 3)
      : topKMedley(poolB, sex, 3);

    const best = topB.length ? topB[0] : null;

    if (best) {
      setRelayB(best.slots);
      setBaselineB(best.sumMs);
      setTop3B(topB);
    } else {
      setRelayB(null);
      setBaselineB(null);
      setTop3B([]);
    }

    setExcludedIds(nextExcluded);
    return;
  }

  if (which === 'C') {
    if (!relayA || !relayB) return;

    const used = new Set<string>([
      ...relayA.map(s => s.athleteId!).filter(Boolean) as string[],
      ...relayB.map(s => s.athleteId!).filter(Boolean) as string[],
    ]);

    const poolC = nextCandidates.filter(c => !used.has(c.id));

    const topC = relayType === 'Libre'
      ? topKFree(poolC, sex, 3)
      : topKMedley(poolC, sex, 3);

    const best = topC.length ? topC[0] : null;

    if (best) {
      setRelayC(best.slots);
      setBaselineC(best.sumMs);
      setTop3C(topC);
    } else {
      setRelayC(null);
      setBaselineC(null);
      setTop3C([]);
    }

    setExcludedIds(nextExcluded);
  }
}


  // Totales
  const relayTotal = (slots: RelaySlot[] | null) => {
    if (!slots) return null;
    let sum = 0;
    for (const s of slots) {
      const key: AllLeg = relayType === 'Libre' ? 'Libre' : s.leg;
      const ms = s.athleteId ? byId[s.athleteId]?.bestByBase?.[key]?.timeMs ?? null : null;
      if (ms == null) return null;
      sum += ms;
    }
    return sum;
  };

  const distanceLabel = useMemo(
    () => (DISTANCE_OPTIONS.find(d => d.value === distance)?.label ?? `${distance} m`),
    [distance]
  );

  const headerTitle = `Resultados · Relevos`;
  const showClear = !!relayA || !!relayB || !!relayC || excludedIds.size > 0;

  // Limpiar todo
  function clearAll() {
    setRelayA(null); setRelayB(null); setRelayC(null);
    setBaselineA(null); setBaselineB(null); setBaselineC(null);
    setTop3A([]); setTop3B([]); setTop3C([]);
    setExcludedIds(new Set());
  }

  // ====== RENDER ======
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right']}>
      {/* Header NAVY unificado con “menú” invisible para mantener métrica */}
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerTitle}>{headerTitle}</Text>
          <TouchableOpacity disabled hitSlop={{ top:8, bottom:8, left:8, right:8 }} activeOpacity={1} style={{ opacity: 0 }}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 6 }}>
          {/* Filtros en 1 fila, todo desplazable */}
          <View style={styles.filterRow}>
            {/* Categorías (abre modal multi-select) */}
            <TouchableOpacity onPress={() => setOpenCats(true)} style={styles.filterBox} activeOpacity={0.85}>
              <Text style={styles.filterLabel}>Categorías</Text>
              <Text style={styles.filterValue} numberOfLines={1}>
                {selectedCats.length ? selectedCats.join(', ') : 'Todas'}
              </Text>
            </TouchableOpacity>

            <SingleSelect
              label="Sexo"
              value={sex}
              options={['Masculino', 'Femenino', 'Mixto']}
              open={openSex}
              setOpen={setOpenSex}
              onSelect={(v) => setSex(v as SexFilter)}
            />

            <SingleSelect
              label="Estilo"
              value={relayType}
              options={['Libre', 'Combinado']}
              open={openType}
              setOpen={setOpenType}
              onSelect={(v) => setRelayType(v as RelayType)}
            />

            {/* Distancia */}
            <>
              <TouchableOpacity onPress={() => setOpenDist(true)} style={styles.filterBox} activeOpacity={0.85}>
                <Text style={styles.filterLabel}>Distancia</Text>
                <Text style={styles.filterValue} numberOfLines={1}>{distanceLabel}</Text>
              </TouchableOpacity>

              <Modal transparent visible={openDist} animationType="fade" onRequestClose={() => setOpenDist(false)}>
                <Pressable style={styles.modalBackdrop} onPress={() => setOpenDist(false)} />
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>Distancia</Text>
                  <FlatList
                    data={DISTANCE_OPTIONS}
                    keyExtractor={(i) => String(i.value)}
                    renderItem={({ item }) => {
                      const active = item.value === distance;
                      return (
                        <TouchableOpacity
                          onPress={() => { setDistance(item.value); setOpenDist(false); }}
                          style={[styles.optRow, active && { backgroundColor: '#EEF2F7' }]}
                          activeOpacity={0.9}
                        >
                          <Text style={{ color: NAVY, fontWeight: active ? '900' as const : '700' }}>
                            {item.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
                  <TouchableOpacity onPress={() => setOpenDist(false)} style={styles.modalClose}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>Listo</Text>
                  </TouchableOpacity>
                </View>
              </Modal>
            </>
          </View>

          {/* Modal de categorías */}
          <CategoriesModal
            open={openCats}
            setOpen={setOpenCats}
            selected={selectedCats}
            onToggle={(val) => {
              setSelectedCats((prev) =>
                prev.includes(val) ? prev.filter((c) => c !== val) : [...prev, val]
              );
            }}
          />

          {/* Botones principales */}
          <TouchableOpacity onPress={computeA} style={styles.calcBtn} activeOpacity={0.9}>
            <Text style={{ color:'#fff', fontWeight:'800' }}>Calcular</Text>
          </TouchableOpacity>

          {relayA && !relayB && (
            <TouchableOpacity onPress={computeBRespectingA} style={styles.nextBtn} activeOpacity={0.9}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Calcular siguiente relevo</Text>
            </TouchableOpacity>
          )}
          {relayA && relayB && !relayC && (
            <TouchableOpacity onPress={computeCRespectingAB} style={styles.nextBtn} activeOpacity={0.9}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Calcular siguiente relevo</Text>
            </TouchableOpacity>
          )}

          {/* Relevo A */}
          {relayA && (
            <>
              <RelayCard
                relayKey="A"
                title={`Relevo A (${distanceLabel})`}
                slots={relayA}
                byId={byId}
                relayType={relayType}
                total={relayTotal(relayA)}
                baselineMs={baselineA}
                onPressSlot={(idx) => openReplaceDialog('A', idx)}
                onMinus={(idx, id) => excludeAndRecompute('A', id)}
              />
              <Top3Card
                open={top3OpenA}
                setOpen={setTop3OpenA}
                entries={top3A}
                relayType={relayType}
                byId={byId}
                title="Top 3 variaciones más rápidas (A)"
              />
            </>
          )}

          {/* Relevo B */}
          {relayB && (
            <>
              <RelayCard
                relayKey="B"
                title={`Relevo B (${distanceLabel})`}
                slots={relayB}
                byId={byId}
                relayType={relayType}
                total={relayTotal(relayB)}
                baselineMs={baselineB}
                onPressSlot={(idx) => openReplaceDialog('B', idx)}
                onMinus={(idx, id) => excludeAndRecompute('B', id)}
              />
              <Top3Card
                open={top3OpenB}
                setOpen={setTop3OpenB}
                entries={top3B}
                relayType={relayType}
                byId={byId}
                title="Top 3 variaciones más rápidas (B)"
              />
            </>
          )}

          {/* Relevo C */}
          {relayC && (
            <>
              <RelayCard
                relayKey="C"
                title={`Relevo C (${distanceLabel})`}
                slots={relayC}
                byId={byId}
                relayType={relayType}
                total={relayTotal(relayC)}
                baselineMs={baselineC}
                onPressSlot={(idx) => openReplaceDialog('C', idx)}
                onMinus={(idx, id) => excludeAndRecompute('C', id)}
              />
              <Top3Card
                open={top3OpenC}
                setOpen={setTop3OpenC}
                entries={top3C}
                relayType={relayType}
                byId={byId}
                title="Top 3 variaciones más rápidas (C)"
              />
            </>
          )}

          {/* Botón limpiar */}
          {showClear && (
            <TouchableOpacity onPress={clearAll} style={[styles.calcBtn, { backgroundColor: NAVY, marginTop: 8 }]} activeOpacity={0.9}>
              <Text style={{ color:'#fff', fontWeight:'800' }}>Limpiar</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// Card de Relevo
function RelayCard({
  relayKey,
  title,
  slots,
  byId,
  relayType,
  total,
  baselineMs,
  onPressSlot,
  onMinus,
}: {
  relayKey: 'A' | 'B' | 'C';
  title: string;
  slots: RelaySlot[];
  byId: Record<string, Candidate>;
  relayType: RelayType;
  total: number | null;
  baselineMs: number | null;
  onPressSlot: (index: number) => void;
  onMinus: (index: number, id?: string) => void;
}) {
  const diffMs = total != null && baselineMs != null ? total - baselineMs : null;

  return (
    <View style={styles.card}>
      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.totalTxt}>Total: {msToStr(total)}{diffToStr(diffMs ?? null)}</Text>
      </View>

      {slots.map((s, i) => {
        const key: AllLeg = relayType === 'Libre' ? 'Libre' : s.leg;
        const cand = s.athleteId ? byId[s.athleteId] : undefined;
        const timeMs = cand?.bestByBase?.[key]?.timeMs ?? null;
        const timeStr = cand?.bestByBase?.[key]?.timeStr ?? msToStr(timeMs);
        const label = relayType === 'Libre' ? `Posta ${i + 1}` : s.leg;

        return (
          <View key={i} style={styles.row}>
            <Text style={[styles.rowLeft]}>{label}</Text>

            <TouchableOpacity
              onPress={() => onPressSlot(i)}
              style={[styles.rowCenterBtn, !cand && { borderStyle: 'dashed' }]}
              activeOpacity={0.9}
            >
              <Text style={[styles.rowCenterText, !cand && { color: '#8A98A8' }]} numberOfLines={1}>
                {cand ? cand.name : 'Elegir nadador'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.rowRight}>{timeStr}</Text>

            <TouchableOpacity
              onPress={() => onMinus(i, s.athleteId)}
              style={styles.kickBtn}
              hitSlop={{ top:6, bottom:6, left:6, right:6 }}
            >
              <Text style={styles.kickTxt}>–</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

// Card Top-3 variaciones
function Top3Card({
  open,
  setOpen,
  entries,
  relayType,
  byId,
  title,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  entries: Array<{ slots: RelaySlot[]; sumMs: number }>;
  relayType: RelayType;
  byId: Record<string, Candidate>;
  title: string;
}) {
  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={() => setOpen(!open)} activeOpacity={0.9}>
        <Text style={styles.cardTitle}>{open ? '▼ ' : '▶ '}{title}</Text>
      </TouchableOpacity>

      {open && (
        <View style={{ marginTop: 8 }}>
          {entries.map((entry, idx) => (
            <View key={idx} style={styles.subCard}>
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                <Text style={styles.cardTitle}>#{idx + 1}</Text>
                <Text style={styles.totalTxt}>Total: {msToStr(entry.sumMs)}</Text>
              </View>
              {entry.slots.map((s, i) => {
                const key: AllLeg = relayType === 'Libre' ? 'Libre' : s.leg;
                const cand = s.athleteId ? byId[s.athleteId] : undefined;
                const timeStr = cand?.bestByBase?.[key]?.timeStr ?? msToStr(cand?.bestByBase?.[key]?.timeMs ?? null);
                const label = relayType === 'Libre' ? `Posta ${i + 1}` : s.leg;
                return (
                  <View key={`${idx}-${i}`} style={styles.row}>
                    <Text style={styles.rowLeft}>{label}</Text>
                    <Text style={[styles.rowCenterText, { flex:1, paddingHorizontal: 10 }]} numberOfLines={1}>
                      {cand?.name ?? '—'}
                    </Text>
                    <Text style={styles.rowRight}>{timeStr}</Text>
                  </View>
                );
              })}
            </View>
          ))}
          {entries.length === 0 && (
            <Text style={{ color: MUTED, marginTop: 6 }}>No hay suficientes combinaciones válidas.</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ===== Estilos =====
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
    paddingHorizontal: 12,
    includeFontPadding: false as any,
  },
  backText: { color:'#fff', fontSize:18, includeFontPadding: false as any },
  menuIcon: { color:'#fff', fontSize:22, fontWeight:'800', includeFontPadding: false as any },

  filterRow: {
    flexDirection:'row',
    justifyContent:'space-between',
    paddingHorizontal: 12,
    marginTop: 10,
  },
  filterBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: '#fff',
    padding: 8,
    marginHorizontal: 4,
  },
  filterLabel: { color: MUTED, fontSize: 12, fontWeight: '700' },
  filterValue: { color: NAVY, fontWeight: '800', marginTop: 2 },

  calcBtn: {
    backgroundColor: RED,
    borderRadius: 12,
    marginHorizontal: 12,
    marginTop: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  nextBtn: {
    backgroundColor: NAVY,
    borderRadius: 12,
    marginHorizontal: 12,
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },

  modalBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.35)' },
  modalCard: {
    position:'absolute',
    left:16,
    right:16,
    top:'15%',
    bottom:'15%',
    backgroundColor:'#fff',
    borderRadius:12,
    borderWidth:1,
    borderColor:BORDER,
    padding:12,
    shadowColor:'#000',
    shadowOpacity:0.15,
    shadowRadius:12,
    elevation:6,
  },
  modalTitle: { color: NAVY, fontWeight:'900', marginBottom:8 },
  optRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  modalClose: {
    alignSelf:'center',
    marginTop:12,
    backgroundColor: RED,
    borderRadius:18,
    paddingHorizontal:16,
    paddingVertical:10,
  },

  card: {
    backgroundColor:'#fff',
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  subCard: {
    backgroundColor:'#fff',
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
  },
  cardTitle: { color: NAVY, fontWeight:'900' },
  totalTxt: { color: NAVY, fontWeight:'900' },

  row: {
    flexDirection:'row',
    alignItems:'center',
    backgroundColor:'#fff',
    marginTop: 10,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  rowLeft: { color: MUTED, fontWeight:'800', width: 90 },
  rowCenterBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    marginHorizontal: 10,
  },
  rowCenterText: { color: NAVY, fontWeight:'800' },
  rowRight: { color: NAVY, fontWeight:'900' },
  kickBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems:'center',
    justifyContent:'center',
    backgroundColor:'#fff',
  },
  kickTxt: { color: RED, fontWeight:'900', fontSize: 18, lineHeight: 20 },
});