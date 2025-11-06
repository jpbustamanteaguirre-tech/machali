// src/theme/layout.ts
export const NAVY = '#0B1E2F';

// Altura base del TabBar (sin safe area)
export const TAB_BAR_BASE_HEIGHT = 56;

// Padding inferior estándar para listas (sin “aire” extra)
export const LIST_PADDING_BOTTOM = 8;

// Posición estándar del FAB rojo (pegado al tab bar)
export const getFabStyle = (insets: { bottom: number }) => ({
  position: 'absolute' as const,
  right: 16,
  bottom: Math.max(8, insets.bottom - 30),
});

// Estilo unificado del TabBar (úsalo en (tabs)/_layout.tsx)
export const getTabBarStyle = (insets: { bottom: number }) => ({
  backgroundColor: NAVY,
  borderTopColor: 'transparent',
  height: TAB_BAR_BASE_HEIGHT + insets.bottom,
  paddingBottom: Math.max(insets.bottom, 8),
});
