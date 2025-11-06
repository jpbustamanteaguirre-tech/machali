// src/components/NavyBottomInset.tsx
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const NAVY = '#0B1E2F';

/**
 * Pinta SIEMPRE la zona segura inferior con NAVY.
 * Funciona incluso con navegación por gestos (Android 10+).
 */
export default function NavyBottomInset() {
  const insets = useSafeAreaInsets();

  // Si no hay inset inferior, no renderiza nada
  if (!insets.bottom) return null;

  return (
    <SafeAreaView
      edges={['bottom']}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: NAVY,
      }}
      // Deja pasar toques al tab bar debajo
      pointerEvents="none"
    >
      <View style={{ height: insets.bottom }} />
    </SafeAreaView>
  );
}
