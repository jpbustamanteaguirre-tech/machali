// app/auth/pending.tsx
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  doc,
  getDoc,
  getDocFromCache,
  getDocFromServer,
} from 'firebase/firestore';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../src/services/firebase';
import { useAuth } from '../../src/stores/authStore';

const Gradient: any = LinearGradient;
const GRADIENT_COLORS = ['#CE2434', '#7E1A27', '#401520', '#0B1E2F'];
const brandLogoLight = require('../../assets/images/logoblanco.png');

const OK_ROLES = new Set(['admin', 'coach', 'athlete', 'guardian']);
function isApprovedLike(data: any): boolean {
  if (!data) return false;
  if (data.approved === true) return true;
  if (data.status === 'active' || data.status === 'approved') return true;
  if (data.role && OK_ROLES.has(String(data.role))) return true;
  return false;
}

export default function PendingApproval() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const uid = user?.uid;

  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [hasPositiveSignal, setHasPositiveSignal] = useState(false);

  // Navegación segura (trampolín)
  const goToTabs = async () => {
    try {
      router.replace('/go/tabs'); // salta al redireccionador → "/"
    } catch {
      router.replace('/'); // fallback directo al index real
    }
  };

  const revisarSolicitud = async () => {
    if (!uid) {
      Alert.alert('Sesión', 'No hay sesión activa. Inicia sesión nuevamente.');
      return;
    }
    setChecking(true);
    setHint(null);

    const ref = doc(db, 'users', uid);

    try {
      // 1) Intento directo con el servidor
      try {
        const s = await getDocFromServer(ref);
        if (s?.exists()) {
          const ok = isApprovedLike(s.data());
          setHasPositiveSignal(prev => prev || ok);
          if (ok) {
            await getDoc(ref).catch(() => {}); // precalienta caché
            await new Promise(r => setTimeout(r, 100));
            await goToTabs();
            return;
          }
        }
      } catch {}

      // 2) Caché local (offline)
      try {
        const c = await getDocFromCache(ref);
        if (c?.exists()) {
          const ok = isApprovedLike(c.data());
          setHasPositiveSignal(prev => prev || ok);
          if (ok) {
            await goToTabs();
            return;
          }
        }
      } catch {}

      // 3) Lectura normal (fallback mixto)
      try {
        const n = await getDoc(ref);
        if (n?.exists()) {
          const ok = isApprovedLike(n.data());
          setHasPositiveSignal(prev => prev || ok);
          if (ok) {
            await goToTabs();
            return;
          }
        }
      } catch {}

      setHint('Tu solicitud aún no aparece como aprobada. Intenta nuevamente en unos segundos.');
    } catch {
      setHint('No se pudo verificar ahora. Revisa tu conexión o inténtalo nuevamente.');
    } finally {
      setChecking(false);
    }
  };

  const entrarDeTodosModos = async () => {
    await goToTabs();
  };

  const secondBtnDisabled = !hasPositiveSignal || checking;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'right', 'left', 'bottom']}>
      <Gradient
        colors={GRADIENT_COLORS}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: Math.max(24, insets.bottom + 24),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Image
          source={brandLogoLight}
          style={{ width: 120, height: 120, marginBottom: 12 }}
          resizeMode="contain"
        />
        <Text style={styles.title}>Solicitud en curso</Text>
        <Text style={styles.subtitle}>
          Un administrador debe aprobar tu solicitud. Cuando esté aprobada,
          podrás acceder al resto de la app.
        </Text>

        {hint ? <Text style={styles.tip}>{hint}</Text> : null}

        <TouchableOpacity
          disabled={checking}
          onPress={revisarSolicitud}
          style={[styles.btn, checking && { opacity: 0.7 }]}
        >
          <Text style={styles.btnText}>
            {checking ? 'Revisando…' : 'Revisar solicitud'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          disabled={secondBtnDisabled}
          onPress={entrarDeTodosModos}
          style={[
            styles.btnOutline,
            secondBtnDisabled && { opacity: 0.4 },
          ]}
        >
          <Text style={[styles.btnText, { color: '#fff' }]}>Entrar de todos modos</Text>
        </TouchableOpacity>

        {checking ? <ActivityIndicator style={{ marginTop: 8 }} color="#fff" /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 22,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.9)',
    marginTop: 10,
    textAlign: 'center',
    fontWeight: '600',
  },
  tip: {
    color: 'rgba(255,255,255,0.85)',
    marginTop: 10,
    textAlign: 'center',
  },
  btn: {
    marginTop: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 200,
    alignItems: 'center',
  },
  btnOutline: {
    marginTop: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'transparent',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 200,
    alignItems: 'center',
  },
  btnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    textAlign: 'center',
  },
});
