// app/(tabs)/_layout.tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../src/stores/authStore';
import { getTabBarStyle } from '../../src/theme/layout';

const ACTIVE = '#CE2434';
const INACTIVE = '#8A98A8';
const BG = '#F7F8FA';

type Role = 'admin' | 'coach' | 'athlete' | 'guardian';

const visibleTabs: Record<Role, Record<string, boolean>> = {
  admin:    { home: true, athletes: true, results: true, events: true, attendance: true, profile: true, config: true },
  coach:    { home: true, athletes: true, results: true, events: true, attendance: true, profile: true, config: false },
  athlete:  { home: true, athletes: false, results: true, events: true, attendance: false, profile: true, config: false },
  guardian: { home: true, athletes: true,  results: true, events: true, attendance: false, profile: true, config: false },
};

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();

  // Si aún no cargó el perfil, no bloqueamos: mostramos tabs con un rol seguro por defecto.
  const role: Role = (profile?.role as Role) || 'athlete';
  const show = visibleTabs[role];

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: getTabBarStyle(insets),
          tabBarActiveTintColor: ACTIVE,
          tabBarInactiveTintColor: INACTIVE,
          tabBarHideOnKeyboard: true,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            tabBarLabel: 'Inicio',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="athletes"
          options={{
            tabBarLabel: 'Nadadores',
            href: show.athletes ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="people-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="results"
          options={{
            tabBarLabel: 'Resultados',
            href: show.results ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="podium-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="events"
          options={{
            tabBarLabel: 'Eventos',
            href: show.events ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="calendar-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="attendance"
          options={{
            tabBarLabel: 'Asistencia',
            href: show.attendance ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="checkmark-done-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            tabBarLabel: 'Perfil',
            href: show.profile ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-circle-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="config"
          options={{
            tabBarLabel: 'Config',
            href: show.config ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" color={color} size={size} />
            ),
          }}
        />

        {/* Rutas ocultas (no aparecen en la tab bar) */}
        <Tabs.Screen name="configPending" options={{ href: null }} />
        <Tabs.Screen name="times" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
