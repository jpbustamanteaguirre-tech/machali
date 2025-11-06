// app/times/new.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import {
  addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Keyboard, KeyboardAvoidingView,
  KeyboardEvent,
  Platform,
  Pressable,
  ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';
import { maskTimeDigitsToDisplay, timeStrToMs } from '../../src/utils/time';

const NAVY   = '#0B1E2F';
const RED    = '#CE2434';
const BG     = '#F7F8FA';
const BORDER = '#E6E8EC';
const MUTED  = '#8A98A8';

type EventDoc = {
  name: string; date?: string; dateDisplay?: string; location?: string; qualifying?: boolean; poolLength?: number;
};
type Athlete = { id: string; name: string; rutDisplay?: string; status?: 'pending'|'active'|'inactive' };
type Row = { id: string; style?: 'Libre'|'Espalda'|'Pecho'|'Mariposa'|'Combinado'; distance?: number };

const STYLE_OPTIONS: Array<NonNullable<Row['style']>> = ['Libre','Espalda','Pecho','Mariposa','Combinado'];
const DISTANCES_BY_STYLE: Record<NonNullable<Row['style']>, number[]> = {
  Libre:[25,50,100,200,400,800,1500],
  Espalda:[25,50,100,200],
  Pecho:[25,50,100,200],
  Mariposa:[25,50,100,200],
  Combinado:[100,200,400],
};

// Caché local de nadadores (mismo nombre que usa el tab de Nadadores)
const CACHE_ATHLETES_KEY = 'athletes_cache_v1';

const toTitle = (s:string) => (s||'').toLowerCase().split(' ').filter(Boolean).map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' ');
const normalize = (s:string) => (s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const matchTokens = (name:string, q:string) => {
  const N = normalize(name), tokens = normalize(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every(t => N.includes(t));
};

// Alto del teclado (ambos SO)
function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => setH((e as any).endCoordinates?.height ?? 0);
    const onHide = () => setH(0);
    const s1 = Keyboard.addListener(showEvt as any, onShow as any);
    const s2 = Keyboard.addListener(hideEvt as any, onHide as any);
    return () => { s1.remove(); s2.remove(); };
  }, []);
  return h;
}

// Valida que el tiempo tenga al menos SS.cc (4 dígitos) y convierta a ms
const hasValidTime = (digits: string) => {
  const d = (digits || '').replace(/\D/g, '');
  if (d.length < 4) return false; // requiere al menos SScc
  const ms = timeStrToMs(maskTimeDigitsToDisplay(d));
  return typeof ms === 'number' && ms >= 0;
};

export default function TimeNew() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const insets = useSafeAreaInsets();
  useAuth();

  // Evento
  const [eventData, setEventData] = useState<EventDoc | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(!!eventId);

  // Nadadores (ventana flotante)
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [search, setSearch] = useState('');
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const searchRef = useRef<TextInput>(null);

  // Filas de pruebas
  const rowSeq = useRef(1);
  const [rows, setRows] = useState<Row[]>([{ id:`r-${rowSeq.current}` }]);

  // Sheets (flotantes)
  type Sheet =
    | { type:'athlete' }
    | { type:'style'; rowId:string }
    | { type:'distance'; rowId:string; style:NonNullable<Row['style']> }
    | null;
  const [sheet, setSheet] = useState<Sheet>(null);

  // Tiempos/Notas (refs → evita “tiriteo”)
  const timeRef = useRef<Record<string, string>>({});
  const noteRef  = useRef<Record<string, string>>({});
  const [canSave, setCanSave] = useState(false);

  // Teclado / FAB / aire mínimo
  const kbHeight  = useKeyboardHeight();
  const kbVisible = kbHeight > 0;
  const MIN_AIR   = 6;
  const spacerBottom = kbVisible ? MIN_AIR : 0;
  const fabBottom = kbVisible ? kbHeight + 12 : insets.bottom + 16;
  const HEADER_H = 56;

  // ====== Carga del evento ======
  useEffect(() => {
    const load = async () => {
      if (!eventId) return;
      setLoadingEvent(true);
      try {
        const snap = await getDoc(doc(db, 'events', String(eventId)));
        if (!snap.exists()) { Alert.alert('Ups','Evento no encontrado'); router.back(); return; }
        const raw = snap.data() as any;
        setEventData({
          name: toTitle(raw.name || 'Evento'),
          date: raw.date, dateDisplay: raw.dateDisplay,
          location: raw.location, qualifying: !!raw.qualifying, poolLength: raw.poolLength || 25,
        });
      } catch { Alert.alert('Error','No se pudo cargar el evento'); }
      finally { setLoadingEvent(false); }
    };
    load();
  }, [eventId]);

  // ====== Nadadores: arranque OFFLINE desde caché ======
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_ATHLETES_KEY);
        if (raw) {
          const arr = JSON.parse(raw) as Athlete[];
          setAthletes(arr);
        }
      } catch {}
    })();
  }, []);

  // ====== Nadadores: snapshot ONLINE que actualiza y persiste el caché ======
  useEffect(() => {
    const qy = query(
      collection(db,'athletes'),
      where('status','==','active'),
      orderBy('name','asc')
    );
    return onSnapshot(qy, async (snap) => {
      const arr: Athlete[] = [];
      snap.forEach(d => {
        const data = d.data() as any;
        arr.push({ id:d.id, ...data, name: toTitle(data?.name || '') });
      });
      setAthletes(arr);
      try { await AsyncStorage.setItem(CACHE_ATHLETES_KEY, JSON.stringify(arr)); } catch {}
    });
  }, []);

  const filteredAthletes = useMemo(() => {
    const q = search.trim();
    if (!q) return athletes;
    return athletes.filter(a =>
      matchTokens(a.name, q) || (!!a.rutDisplay && normalize(a.rutDisplay).includes(normalize(q)))
    );
  }, [search, athletes]);

  // ====== Handlers ======
  const addRow = useCallback(() => {
    const id = `r-${++rowSeq.current}`;
    setRows(prev => [{ id }, ...prev]); // ← agrega ARRIBA
  }, []);

  const removeRow = useCallback((id:string) => {
    setRows(prev => {
      const next = prev.length > 1 ? prev.filter(r => r.id !== id) : prev;
      delete timeRef.current[id];
      delete noteRef.current[id];
      const ok =
        !!eventData &&
        !!selectedAthlete &&
        next.some(r => r.style && r.distance && hasValidTime(timeRef.current[r.id] || ''));
      setCanSave(ok);
      return next;
    });
  }, [eventData, selectedAthlete]);

  const openStyle = useCallback((rowId:string) => { Keyboard.dismiss(); setSheet({ type:'style', rowId }); }, []);
  const openDistance = useCallback((rowId:string, style?:Row['style']) => {
    if (!style) return; Keyboard.dismiss(); setSheet({ type:'distance', rowId, style });
  }, []);

  const closeSheet = useCallback(() => { setSheet(null); Keyboard.dismiss(); }, []);

  const setStyleSel = useCallback((rowId:string, style:Row['style']) => {
    setRows(prev => prev.map(r => r.id===rowId ? ({ ...r, style, distance: undefined }) : r));
    closeSheet();
  }, [closeSheet]);

  const setDistanceSel = useCallback((rowId:string, distance:number) => {
    setRows(prev => prev.map(r => r.id===rowId ? ({ ...r, distance }) : r));
    closeSheet();
  }, [closeSheet]);

  const onChangeTime = useCallback((rowId:string, digits:string) => {
    timeRef.current[rowId] = digits;
    const ok =
      !!eventData &&
      !!selectedAthlete &&
      rows.some(r => r.style && r.distance && hasValidTime(timeRef.current[r.id] || ''));
    setCanSave(ok);
  }, [eventData, selectedAthlete, rows]);

  const onChangeNote = useCallback((rowId:string, note:string) => { noteRef.current[rowId] = note; }, []);

  // Recalcular cuando cambian dependencias clave
  useEffect(() => {
    const ok =
      !!eventData &&
      !!selectedAthlete &&
      rows.some(r => r.style && r.distance && hasValidTime(timeRef.current[r.id] || ''));
    setCanSave(ok);
  }, [eventData, selectedAthlete, rows]);

  const clearAthlete = () => { setSelectedAthlete(null); setSearch(''); };

  // ====== Guardar ======
  const save = async () => {
    if (!eventId || !eventData) return Alert.alert('Ups','Falta el evento.');
    if (!selectedAthlete) return Alert.alert('Ups','Selecciona un nadador.');

    const ops: Promise<any>[] = [];
    for (const r of rows) {
      if (!r.style || !r.distance) continue;
      const digits = timeRef.current[r.id] || '';
      if (!hasValidTime(digits)) continue;

      const display = maskTimeDigitsToDisplay(digits);
      const ms = timeStrToMs(display)!;

      ops.push(addDoc(collection(db,'results'), {
        eventId: String(eventId),
        athleteId: selectedAthlete.id, athleteName: selectedAthlete.name,
        style: r.style, distance: r.distance,
        origin: 'Race' as const,
        date: eventData.date || null, dateDisplay: eventData.dateDisplay || null,
        timeMs: ms, timeStr: display, poolLength: eventData.poolLength || 25,
        isPersonal:false,
        note: (noteRef.current[r.id]||'').trim() || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),              // 👈 habilita delta updates
      }));
    }
    if (!ops.length) return Alert.alert('Ups','Completa al menos una prueba con tiempo válido.');
    try {
      await Promise.all(ops);
      // Dispara delta en el resumen
      await setDoc(doc(db,'meta','results'), { lastUpdatedAt: serverTimestamp() }, { merge:true });
      Alert.alert('Listo','Tiempos cargados correctamente.');
      router.back();
    } catch (e:any) {
      Alert.alert('Error', e?.message ?? 'No se pudo guardar.');
    }
  };

  // ====== Header ======
  const Header = () => (
    <SafeAreaView edges={['top','left','right']} style={{ backgroundColor:NAVY }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={()=>router.back()} hitSlop={{top:8,bottom:8,left:8,right:8}}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text numberOfLines={1} style={styles.headerTitle}>Cargar tiempos</Text>
        <Text style={styles.menuIcon} accessibilityElementsHidden importantForAccessibility="no">&nbsp;</Text>
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
    </SafeAreaView>
  );

  // ====== UI ======
  const Content = (
    <ScrollView
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ paddingTop: 12, paddingBottom: spacerBottom }}
      {...(Platform.OS === 'ios'
        ? { contentInset: { bottom: 0 }, scrollIndicatorInsets: { bottom: 0 }, automaticallyAdjustKeyboardInsets: true }
        : {})}
    >
      {/* Competencia */}
      <View style={[styles.card, { marginHorizontal:16 }]}>
        <Text style={styles.sectionTitle}>Competencia</Text>
        <Row label="Nombre" value={eventData?.name ?? '—'} />
        <Row label="Fecha" value={eventData?.dateDisplay ?? eventData?.date ?? '—'} />
        <Row label="Piscina" value={eventData?.poolLength ? `${eventData?.poolLength}m` : '—'} />
        <Row label="Válida" value={eventData?.qualifying ? 'Sí':'No'} valueStyle={{ color: eventData?.qualifying ? '#0E7A3E' : '#B00020' }} />
      </View>

      {/* BÚSQUEDA + AGREGAR */}
      <View style={[styles.card, { marginHorizontal:16, marginTop:10 }]}>
        <Text style={styles.sectionTitle}>Nadador</Text>

        <View style={{ flexDirection:'row', gap:8, alignItems:'center' }}>
          <TouchableOpacity onPress={() => { setSheet({ type:'athlete' }); setTimeout(()=>searchRef.current?.focus(),0); }} activeOpacity={0.9} style={[styles.inputLike, { flex:3 }]}>
            <Text style={[styles.selectBtnTxt, !selectedAthlete && { color:MUTED }]}>
              {selectedAthlete ? toTitle(selectedAthlete.name) : 'Buscar por nombre o RUT'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={addRow} style={[styles.addBtn, { flex:1, height:48 }]} activeOpacity={0.9}>
            <Text style={styles.addBtnTxt}>+ Agregar</Text>
          </TouchableOpacity>
        </View>

        {selectedAthlete && (
          <View style={{ marginTop:10, flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
            <Text style={{ color:NAVY, fontWeight:'700' }}>Seleccionado: {toTitle(selectedAthlete.name)}</Text>
            <TouchableOpacity onPress={() => { setSelectedAthlete(null); setSearch(''); }}>
              <Text style={{ color:RED, fontWeight:'800' }}>Cambiar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Pruebas */}
      <Text style={[styles.sectionTitle, { marginHorizontal:16, marginTop:8 }]}>Pruebas</Text>

      {rows.map((r) => (
        <TrialRow
          key={r.id}
          row={r}
          onOpenStyle={() => openStyle(r.id)}
          onOpenDistance={() => openDistance(r.id, r.style)}
          onRemove={() => removeRow(r.id)}
          onChangeTime={(digits) => onChangeTime(r.id, digits)}
          onChangeNote={(note) => onChangeNote(r.id, note)}
        />
      ))}
    </ScrollView>
  );

  if (loadingEvent) {
    return (
      <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
        <Header />
        <View style={styles.center}><Text style={{ color:NAVY }}>Cargando…</Text></View>
        <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, bottom:0, height: insets.bottom, backgroundColor:NAVY }} />
      </SafeAreaView>
    );
  }

  // Altura disponible para sheets
  const TOP = insets.top + HEADER_H;
  const BOTTOM = kbVisible ? kbHeight + 12 : 16;
  const AVAIL = Math.max(160, Dimensions.get('window').height - TOP - BOTTOM - 16);

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: BG }} edges={['left','right']}>
      <Header />

      <KeyboardAvoidingView
        style={{ flex:1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {Content}
      </KeyboardAvoidingView>

      {/* FAB */}
      <TouchableOpacity
        onPress={save}
        activeOpacity={0.95}
        disabled={!canSave}
        style={[styles.fab, { right:16, bottom: fabBottom }, !canSave && { opacity:0.5 }]}
      >
        <Text style={styles.fabTxt}>Guardar</Text>
      </TouchableOpacity>

      {/* Franja NAVY inferior exacta */}
      <View
        pointerEvents="none"
        style={{ position:'absolute', left:0, right:0, bottom:0, height: insets.bottom, backgroundColor:NAVY }}
      />

      {/* ================== SHEET: Buscar nadador ================== */}
      {sheet?.type === 'athlete' && (
        <>
          <Pressable style={styles.dim} onPress={() => setSheet(null)} />
          <View style={[styles.sheet, { top: TOP, bottom: BOTTOM }]}>
            <Text style={styles.sheetTitle}>Buscar nadador</Text>

            <TextInput
              ref={searchRef}
              value={search}
              onChangeText={setSearch}
              placeholder="Nombre o RUT"
              placeholderTextColor={MUTED}
              style={[styles.input, { marginBottom: 8 }]}
              autoFocus autoCorrect={false} autoCapitalize="none" returnKeyType="search"
            />

            <ScrollView keyboardShouldPersistTaps="handled" style={{ flex:1 }}>
              {filteredAthletes.map(a => (
                <Pressable
                  key={a.id}
                  style={styles.rowItem}
                  onPress={() => {
                    setSelectedAthlete(a);
                    setSearch(toTitle(a.name));
                    setSheet(null);
                  }}
                >
                  <Text style={{ color:NAVY, fontWeight:'700' }}>{toTitle(a.name)}</Text>
                  {!!a.rutDisplay && <Text style={{ color:MUTED, marginTop:2 }}>{a.rutDisplay}</Text>}
                </Pressable>
              ))}
              {!filteredAthletes.length && <Text style={{ color:MUTED, paddingVertical:12 }}>Sin resultados…</Text>}
            </ScrollView>

            <TouchableOpacity onPress={() => setSheet(null)} style={styles.sheetClose}>
              <Text style={{ color:NAVY, fontWeight:'800' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ================== SHEET: Estilo ================== */}
      {sheet?.type === 'style' && (
        <>
          <Pressable style={styles.dim} onPress={() => setSheet(null)} />
          <View style={[styles.sheet, { top: TOP, maxHeight: AVAIL }]}>
            <Text style={styles.sheetTitle}>Selecciona estilo</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {STYLE_OPTIONS.map(st => (
                <TouchableOpacity key={st} style={styles.rowItem} onPress={() => setStyleSel(sheet.rowId, st)}>
                  <Text style={{ color:NAVY, fontWeight:'700' }}>{st}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setSheet(null)} style={styles.sheetClose}>
              <Text style={{ color:NAVY, fontWeight:'800' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ================== SHEET: Distancia ================== */}
      {sheet?.type === 'distance' && (
        <>
          <Pressable style={styles.dim} onPress={() => setSheet(null)} />
          <View style={[styles.sheet, { top: TOP, maxHeight: AVAIL }]}>
            <Text style={styles.sheetTitle}>Selecciona distancia</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {DISTANCES_BY_STYLE[sheet.style].map(d => (
                <TouchableOpacity key={d} style={styles.rowItem} onPress={() => setDistanceSel(sheet.rowId, d)}>
                  <Text style={{ color:NAVY, fontWeight:'700' }}>{d} m</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setSheet(null)} style={styles.sheetClose}>
              <Text style={{ color:NAVY, fontWeight:'800' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

// ====== Fila de prueba ======
const TrialRow = memo(function TrialRow({
  row, onOpenStyle, onOpenDistance, onRemove, onChangeTime, onChangeNote,
}: {
  row: Row;
  onOpenStyle: () => void;
  onOpenDistance: () => void;
  onRemove: () => void;
  onChangeTime: (digits: string) => void;
  onChangeNote: (note: string) => void;
}) {
  const [timeDigits, setTimeDigits] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const masked = maskTimeDigitsToDisplay(timeDigits);

  const onTimeChange = (t:string) => {
    const digits = (t||'').replace(/\D/g,'').slice(0,6);
    setTimeDigits(digits);
    onChangeTime(digits);
  };

  return (
    <View style={[styles.card, { marginHorizontal:16, marginBottom:10 }]}>
      <View style={{ flexDirection:'row', gap:8 }}>
        <View style={{ flex:1 }}>
          <Text style={styles.smallLabel}>Estilo</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={onOpenStyle} activeOpacity={0.9}>
            <Text style={[styles.selectBtnTxt, !row.style && { color:MUTED }]}>
              {row.style ?? 'Seleccionar estilo'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex:1 }}>
          <Text style={styles.smallLabel}>Distancia</Text>
          <TouchableOpacity
            style={[styles.selectBtn, !row.style && { opacity:0.5 }]}
            onPress={onOpenDistance}
            disabled={!row.style}
            activeOpacity={0.9}
          >
            <Text style={[styles.selectBtnTxt, !row.distance && { color:MUTED }]}>
              {row.distance ? `${row.distance} m` : 'Seleccionar distancia'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tiempo */}
      <View style={{ marginTop:10 }}>
        <Text style={styles.smallLabel}>Tiempo (MM:SS.cc o SS.cc)</Text>
        <TextInput
          value={masked}
          onChangeText={onTimeChange}
          keyboardType="number-pad"
          maxLength={8}
          style={styles.input}
        />
      </View>

      {/* Nota (OPCIONAL) */}
      <View style={{ marginTop:10 }}>
        <Text style={styles.smallLabel}>Nota (opcional)</Text>
        <TextInput
          value={note}
          onChangeText={(t)=>{ setNote(t); onChangeNote(t); }}
          placeholder="Ej: viraje largo / subacuáticas"
          placeholderTextColor={MUTED}
          style={[styles.input, { minHeight:48, textAlignVertical:'top' }]}
          multiline
          blurOnSubmit
          returnKeyType="done"
        />
      </View>

      {/* Quitar */}
      <View style={{ flexDirection:'row', justifyContent:'flex-end', marginTop:10 }}>
        <TouchableOpacity onPress={onRemove}>
          <Text style={{ color:'#B00020', fontWeight:'800' }}>Quitar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

function Row({ label, value, valueStyle }: { label: string; value: string; valueStyle?: any }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, valueStyle]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Header
  headerRow: {
    backgroundColor: NAVY, paddingHorizontal:16, paddingVertical:12,
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
  },
  headerTitle: { color:'#fff', fontSize:18, fontWeight:'700', flex:1, paddingHorizontal:12, includeFontPadding:false as any },
  backText: { color:'#fff', fontSize:18, includeFontPadding:false as any },
  menuIcon: { color:NAVY, fontSize:22, fontWeight:'800' },

  center: { flex:1, alignItems:'center', justifyContent:'center', padding:16 },

  sectionTitle: { color:NAVY, fontWeight:'800', marginBottom:8, fontSize:16 },
  smallLabel: { color:MUTED, fontWeight:'700', marginBottom:4 },

  card: { backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:BORDER, padding:12, marginBottom:10 },
  row: { flexDirection:'row', justifyContent:'space-between', marginTop:6 },
  label: { color:MUTED, fontWeight:'700' },
  value: { color:NAVY, fontWeight:'800' },

  selectBtn: { borderWidth:1, borderColor:BORDER, borderRadius:12, paddingHorizontal:14, paddingVertical:12, backgroundColor:'#fff' },
  selectBtnTxt: { color:NAVY, fontWeight:'700' },

  input: { borderWidth:1, borderColor:BORDER, borderRadius:12, paddingHorizontal:14, paddingVertical:12, color:NAVY, backgroundColor:'#fff' },
  inputLike: { borderWidth:1, borderColor:BORDER, borderRadius:12, height:48, paddingHorizontal:14, justifyContent:'center', backgroundColor:'#fff' },

  // Botón Agregar
  addBtn: { backgroundColor:RED, borderRadius:12, paddingVertical:12, alignItems:'center', justifyContent:'center' },
  addBtnTxt: { color:'#fff', fontWeight:'800' },

  // FAB
  fab: { position:'absolute', backgroundColor:RED, borderRadius:28, paddingHorizontal:18, paddingVertical:14, zIndex:10, elevation:10 },
  fabTxt: { color:'#fff', fontWeight:'800' },

  // Overlays / Sheets
  dim: { position:'absolute', left:0, right:0, top:0, bottom:0, backgroundColor:'rgba(0,0,0,0.25)' },
  sheet: {
    position:'absolute', left:16, right:16,
    backgroundColor:'#fff', borderRadius:12, borderWidth:1, borderColor:BORDER,
    padding:12, zIndex:30, elevation:30,
  },
  sheetTitle: { color:NAVY, fontWeight:'800', marginBottom:8, fontSize:16 },
  rowItem: { paddingVertical:10, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:BORDER },
  sheetClose: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
