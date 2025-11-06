// src/services/firebase.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  enableIndexedDbPersistence,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// === Lee config desde app.json -> expo.extra.firebase ===
const extra = (Constants.expoConfig?.extra ?? (Constants as any)?.manifest?.extra) as any;
const cfg = extra?.firebase;
if (!cfg) {
  throw new Error('Falta configuración Firebase en app.json -> expo.extra.firebase');
}

// === App ===
const app: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(cfg);

// === Auth (con persistencia adecuada en RN) ===
let firebaseAuth: any;

if (Platform.OS === 'ios' || Platform.OS === 'android') {
  // RN nativo: initializeAuth con persistencia en AsyncStorage
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const authMod = require('firebase/auth');
  try {
    firebaseAuth = authMod.initializeAuth(app, {
      persistence: authMod.getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Si ya fue inicializado en caliente
    firebaseAuth = authMod.getAuth(app);
  }
} else {
  // Web: usa local persistence del navegador
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const authMod = require('firebase/auth');
  firebaseAuth = authMod.getAuth(app);
  authMod.setPersistence(firebaseAuth, authMod.browserLocalPersistence).catch(() => {});
}

// === Firestore ===
// En RN: initializeFirestore con auto long-polling (mejora compatibilidad de red).
// En Web: getFirestore + IndexedDB persistence (best effort).
let db: ReturnType<typeof getFirestore>;

if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try {
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      // experimentalForceLongPolling: true, // <- habilítalo sólo si tu red lo requiere
      ignoreUndefinedProperties: true,
    });
  } catch {
    db = getFirestore(app);
  }
} else {
  db = getFirestore(app);
  enableIndexedDbPersistence(db).catch(() => {});
}

// === Storage ===
const storage = getStorage(app);

// === Exports ===
export { app, db, firebaseAuth, storage };
export const ADMIN_SEED_EMAIL: string | undefined = extra?.adminSeedEmail;
