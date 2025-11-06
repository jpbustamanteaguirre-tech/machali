// src/components/TitleBar.tsx
import React from 'react';
import { PixelRatio, Platform, StatusBar, Text, TouchableOpacity, View } from 'react-native';

const NAVY = '#0B1E2F';

// Alturas/dimensiones fijas del header (contenido)
export const BAR_HEIGHT = 48;          // alto de la barra (sin status)
export const SIDE_SLOT_WIDTH = 44;     // ancho fijo para los slots izq/der
const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

/**
 * Métricas del header azul unificadas.
 * - ANDROID: usa StatusBar.currentHeight (estable).
 * - iOS: 0 (el safe top lo maneja el propio componente con su banda superior 0).
 * Retorna alturas redondeadas a píxel físico para evitar medias líneas.
 */
export function getTitleBarMetrics() {
  const top = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
  const statusTop = PixelRatio.roundToNearestPixel(top);
  const bar = PixelRatio.roundToNearestPixel(BAR_HEIGHT);
  const total = statusTop + bar; // altura total ocupada por el header visible
  return { statusTop, bar, total };
}

type Props = {
  title: string;
  onPressBack?: () => void;
  onPressMenu?: () => void;
  showBack?: boolean; // default true
  showMenu?: boolean; // default false
};

export default function TitleBar({
  title,
  onPressBack,
  onPressMenu,
  showBack = true,
  showMenu = false,
}: Props) {
  const { statusTop, bar } = getTitleBarMetrics();

  return (
    <View style={{ backgroundColor: NAVY }}>
      {/* Banda superior (status bar) */}
      <View style={{ height: statusTop }} />
      {/* Barra fija */}
      <View
        style={{
          height: bar,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Slot izquierdo fijo para centrar el título */}
        <View style={{ width: SIDE_SLOT_WIDTH, alignItems: 'flex-start', justifyContent: 'center' }}>
          {showBack ? (
            <TouchableOpacity onPress={onPressBack} hitSlop={HIT} accessibilityRole="button">
              <Text allowFontScaling={false} style={{ color: '#fff', fontSize: 18, includeFontPadding: false as any }}>←</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Título centrado */}
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            color: '#fff',
            fontSize: 18,
            fontWeight: '700',
            textAlign: 'center',
            flexShrink: 1,
            includeFontPadding: false as any,
          }}
        >
          {title}
        </Text>

        {/* Slot derecho fijo para balancear y opcional ☰ */}
        <View style={{ width: SIDE_SLOT_WIDTH, alignItems: 'flex-end', justifyContent: 'center' }}>
          {showMenu ? (
            <TouchableOpacity onPress={onPressMenu} hitSlop={HIT} accessibilityRole="button">
              <Text allowFontScaling={false} style={{ color: '#fff', fontSize: 22, fontWeight: '800', includeFontPadding: false as any }}>☰</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}
