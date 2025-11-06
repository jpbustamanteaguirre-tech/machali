// app/config/groups/index.tsx
import { router } from 'expo-router';
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../../src/services/firebase';
import { useAuth } from '../../../src/stores/authStore';

const NAVY = '#0B1E2F';
const BG = '#F7F8FA';
const BORDER = '#E6E8EC';
const RED = '#CE2434';

type Group = {
  id: string;
  name: string;
  headCoachId?: string | null;
  assistantCoachIds?: string[];
  athleteIds?: string[];
  createdAt?: any;
  status?: 'active' | 'inactive';
};

export default function GroupsHome() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canView = profile?.role === 'admin' || profile?.role === 'coach';

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    const qy = query(collection(db, 'groups'), orderBy('name', 'asc'));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr: Group[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setGroups(arr);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const createGroup = async () => {
    if (!isAdmin) return;
    const name = (newName || '').trim();
    if (!name) {
      Alert.alert('Nombre requerido', 'Ingresa un nombre de grupo.');
      return;
    }
    try {
      await addDoc(collection(db, 'groups'), {
        name,
        headCoachId: null,
        assistantCoachIds: [],
        athleteIds: [],
        status: 'active',
        createdAt: serverTimestamp(),
      });
      setNewName('');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo crear el grupo');
    }
  };

  if (!canView) {
    return (
      // 👇 sin Safe Area bottom; franja azul manual exacta
      <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right']}>
        <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Grupos</Text>
          </View>
        </SafeAreaView>
        <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding: 24 }}>
          <Text style={{ color: NAVY }}>No tienes permiso para ver grupos.</Text>
        </View>

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

  return (
    // 👇 sin Safe Area bottom; franja azul manual exacta
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left','right']}>
      <SafeAreaView edges={['top','left','right']} style={{ backgroundColor: NAVY }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Grupos del club</Text>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(i) => i.id}
          // 👇 SIN paddingBottom extra (no agregamos aire)
          contentContainerStyle={{ paddingTop: 8, paddingBottom: Math.max(8, insets.bottom) }}

          ListHeaderComponent={
            isAdmin ? (
              <View style={{ padding: 16, paddingBottom: 8 }}>
                <Text style={{ color: NAVY, fontWeight: '700', marginBottom: 6 }}>Crear nuevo grupo</Text>
                <View style={{ flexDirection:'row' }}>
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="Nombre del grupo"
                    placeholderTextColor="#8A98A8"
                    style={styles.input}
                  />
                  <TouchableOpacity onPress={createGroup} style={styles.btn}>
                    <Text style={{ color:'#fff', fontWeight:'700' }}>Crear</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <Text style={{ color: NAVY }}>No hay grupos creados.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const countCoaches =
              (item.headCoachId ? 1 : 0) + (item.assistantCoachIds?.length ?? 0);
            const countAthletes = item.athleteIds?.length ?? 0;

            return (
              <TouchableOpacity
                onPress={() => router.push(`/config/groups/${item.id}`)}
                style={styles.card}
              >
                <Text style={{ color: NAVY, fontWeight:'800' }}>{item.name}</Text>
                <Text style={{ color: '#4A5A6A', marginTop: 4 }}>
                  {countCoaches} entrenadores · {countAthletes} alumnos
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      )}

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
    flex: 1,
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 44,
    paddingHorizontal: 12, backgroundColor:'#fff', color: NAVY, marginRight: 8,
  },
  btn: {
    backgroundColor: RED, borderRadius: 12, paddingHorizontal: 14, justifyContent:'center',
  },
  card: {
    backgroundColor:'#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
});
