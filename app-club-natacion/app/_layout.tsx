// app/_layout.tsx
import { router, Slot, usePathname, useRootNavigationState, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { AuthProvider, useAuth } from '../src/stores/authStore';

/* -----------------------------
   HistoryProvider (stack casero)
   ----------------------------- */
const historyStack: string[] = [];
let isPushingByProgram = false; // evita loops cuando hacemos push(prev)

function useHistoryTracker() {
  const pathname = usePathname();
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    // Evita re-agregar cuando nosotros mismos hicimos push(prev) en back
    if (isPushingByProgram) {
      isPushingByProgram = false;
      lastRef.current = pathname;
      return;
    }
    if (lastRef.current === pathname) return;

    // Si es un cambio normal, lo apilamos (no intentamos distinguir replace)
    if (historyStack.length === 0 || historyStack[historyStack.length - 1] !== pathname) {
      historyStack.push(pathname);
    } else {
      // mismo pathname 2 veces seguidas: ignora
    }
    lastRef.current = pathname;
  }, [pathname]);
}

function goBackSmart(): boolean {
  // Sacar la ruta actual
  if (historyStack.length > 0) historyStack.pop();
  const prev = historyStack[historyStack.length - 1];

  if (prev) {
    // Vamos a la anterior *exacta*
    isPushingByProgram = true;
    router.push(prev);
    return true; // consumimos el back
  }
  // Sin anterior: dejamos que Android cierre la app
  return false;
}

/* --------------
   Auth Gate
   -------------- */
function AuthGate() {
  const { user, profile, loading } = useAuth();
  const segments = useSegments();
  const nav = useRootNavigationState();

  const segs = Array.isArray(segments) ? (segments as string[]) : [];
  const rootSeg = segs[0] ?? '';
  const subSeg = segs[1] ?? '';

  const inAuth = rootSeg === 'auth';
  const inPending = inAuth && subSeg === 'pending';

  const isAdmin = profile?.role === 'admin';
  const isApproved = isAdmin ? true : profile?.approved === true;

  // Seguimiento de historial en TODAS las pantallas
  useHistoryTracker();

  useEffect(() => {
    if (!nav?.key || loading) return;

    // 1) No logueado -> login (solo si no estamos ya en /auth)
    if (!user) {
      if (!inAuth) router.replace('/auth/login');
      return;
    }

    // 2) Logueado pero NO aprobado -> /auth/pending
    if (!isApproved) {
      if (!inPending) router.replace('/auth/pending');
      return;
    }

    // 3) Logueado y aprobado -> si estamos dentro de /auth, mandamos a tabs
    if (inAuth) router.replace('/(tabs)');
  }, [user, isApproved, inAuth, inPending, loading, nav?.key]);

  return <Slot />;
}

/* --------------
   Root Layout
   -------------- */
export default function RootLayout() {
  // Botón físico Android: back REAL usando nuestro stack
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBack = () => {
      // Si expo-router pudiera volver, también funcionaría, pero
      // priorizamos nuestro stack para “volver exacto”.
      const handled = goBackSmart();
      if (handled) return true;

      // No hay histórico en nuestro stack: intenta back nativo,
      // y si no puede, Android cerrará la app.
      // @ts-ignore canGoBack existe en runtime
      if (typeof router.canGoBack === 'function' && router.canGoBack()) {
        router.back();
        return true;
      }
      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, []);

  return (
    <AuthProvider>
      <StatusBar style="light" backgroundColor="#0B1E2F" translucent={false} />
      <AuthGate />
    </AuthProvider>
  );
}
