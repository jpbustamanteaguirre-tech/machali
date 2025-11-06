// app/(tabs)/config.tsx
import { router } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';

const NAVY = '#0B1E2F';
const BG = '#F7F8FA';
const RED = '#CE2434';
const BORDER = '#E6E8EC';

export default function ConfigMenu() {
  const insets = useSafeAreaInsets();
  const { profile, logout } = useAuth();
  const isAdmin = profile?.role === 'admin';

  // Contadores en vivo
  const [pendingUsers, setPendingUsers] = useState(0);           // users.status == 'pending'
  const [pendingAccessReqs, setPendingAccessReqs] = useState(0); // accessRequests.status == 'pending' (si existe)
  const [pendingAthletes, setPendingAthletes] = useState(0);     // athletes.status == 'pending'

  const totalPendingAccess = pendingUsers + pendingAccessReqs;

  useEffect(() => {
    if (!isAdmin) {
      setPendingUsers(0);
      setPendingAccessReqs(0);
      setPendingAthletes(0);
      return;
    }

    // users.status == 'pending'
    const qUsers = query(collection(db, 'users'), where('status', '==', 'pending'));
    const unsubUsers = onSnapshot(
      qUsers,
      (snap) => setPendingUsers(snap.size),
      () => setPendingUsers(0)
    );

    // accessRequests.status == 'pending' (colección opcional)
    const qReqs = query(collection(db, 'accessRequests'), where('status', '==', 'pending'));
    const unsubReqs = onSnapshot(
      qReqs,
      (snap) => setPendingAccessReqs(snap.size),
      () => setPendingAccessReqs(0)
    );

    // athletes.status == 'pending'  👉 para activaciones de perfiles
    const qAth = query(collection(db, 'athletes'), where('status', '==', 'pending'));
    const unsubAth = onSnapshot(
      qAth,
      (snap) => setPendingAthletes(snap.size),
      () => setPendingAthletes(0)
    );

    return () => {
      unsubUsers?.();
      unsubReqs?.();
      unsubAth?.();
    };
  }, [isAdmin]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo cerrar sesión');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['left', 'right']}>
      {/* Header azul */}
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: NAVY }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Configuración</Text>
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BORDER, opacity: 0.9 }} />
      </SafeAreaView>

      <View style={{ padding: 16 }}>
        {!isAdmin ? (
          <>
            <View style={[styles.cardBtn, { opacity: 0.8 }]}>
              <Text style={[styles.cardTitle, { color: NAVY }]}>Solo administradores</Text>
              <Text style={styles.cardSub}>No tienes permisos para ver las opciones de configuración.</Text>
            </View>

            <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} activeOpacity={0.9}>
              <Text style={styles.logoutTxt}>Cerrar sesión</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* Solicitudes de acceso (creación de cuentas) */}
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/configPending')}
              style={styles.cardBtn}
              activeOpacity={0.9}
            >
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Solicitudes de acceso</Text>
                {totalPendingAccess > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>
                      {totalPendingAccess > 99 ? '99+' : totalPendingAccess}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardSub}>
                Aprueba nuevas cuentas. A deportistas: asigna grupo. A apoderados: vincula deportista.
              </Text>
            </TouchableOpacity>

            {/* 🔵 Activación de perfiles (athletes.status == 'pending') */}
            <TouchableOpacity
              onPress={() => router.push('/config/activations')}
              style={styles.cardBtn}
              activeOpacity={0.9}
            >
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Activación de perfiles</Text>
                {pendingAthletes > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>{pendingAthletes > 99 ? '99+' : pendingAthletes}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardSub}>
                Activa atletas pendientes y asigna su grupo correspondiente.
              </Text>
            </TouchableOpacity>

            {/* Grupos del club */}
            <TouchableOpacity
              onPress={() => router.push('/config/groups')}
              style={styles.cardBtn}
              activeOpacity={0.9}
            >
              <Text style={styles.cardTitle}>Grupos del club</Text>
              <Text style={styles.cardSub}>
                Crear/editar grupos, entrenador a cargo, asistentes y alumnos.
              </Text>
            </TouchableOpacity>

            {/* Importar atletas (CSV) */}
            <TouchableOpacity
              onPress={() => router.push('/config/import')}
              style={styles.cardBtn}
              activeOpacity={0.9}
            >
              <Text style={styles.cardTitle}>Importar atletas (CSV)</Text>
              <Text style={styles.cardSub}>
                Carga masiva desde archivo CSV. Acepta: name, birth, gender, seasonYear, status, groupName.
              </Text>
            </TouchableOpacity>

            {/* Roles de usuarios */}
            <TouchableOpacity
              onPress={() => router.push('/config/roles')}
              style={styles.cardBtn}
              activeOpacity={0.9}
            >
              <Text style={styles.cardTitle}>Roles de usuarios</Text>
              <Text style={styles.cardSub}>
                Asignar o cambiar rol (admin/coach/athlete/guardian).
              </Text>
            </TouchableOpacity>

            {/* Cerrar sesión */}
            <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} activeOpacity={0.9}>
              <Text style={styles.logoutTxt}>Cerrar sesión</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cardBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardTitle: { color: NAVY, fontWeight: '800' },
  cardSub: { color: '#4A5A6A' },

  // Badge pendiente
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: 11,
    backgroundColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  badgeTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },

  // Logout rojo
  logoutBtn: {
    backgroundColor: RED,
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  logoutTxt: { color: '#fff', fontWeight: '700' },
});
