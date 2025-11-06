// src/stores/authStore.ts
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { db, firebaseAuth } from '../services/firebase';
import type { UserRole } from '../types/models';

type AppUser = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  // 🔄 IMPORTANTE: ahora el rol es opcional (lo asigna el admin)
  role?: UserRole;
  // Flag de aprobación (gating)
  approved?: boolean;
  // Datos opcionales que pudiste guardar en el registro
  requestedRole?: 'guardian' | 'athlete';
  linkedAthletes?: string[];
  createdAt?: number;
};

type AuthCtx = {
  loading: boolean;
  user: User | null;
  profile: AppUser | null;
  loginEmail: (email: string, password: string) => Promise<void>;
  registerEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

// 🚫 Sin auto-asignar rol: solo crea perfil base con approved=false si no existe.
async function ensureUserProfile(u: User): Promise<AppUser> {
  const ref = doc(collection(db, 'users'), u.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const base: Partial<AppUser> = {
      uid: u.uid,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
      approved: false, // ⬅️ el admin aprobará y pondrá el rol después
    };

    await setDoc(
      ref,
      {
        ...base,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    // Para el estado local, ponemos createdAt numérico para no romper tipos
    return { ...(base as AppUser), createdAt: Date.now() };
  }

  return { uid: u.uid, ...(snap.data() as any) } as AppUser;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, async (u) => {
      setUser(u);
      try {
        if (u) {
          const p = await ensureUserProfile(u);
          setProfile(p);
        } else {
          setProfile(null);
        }
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const loginEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(firebaseAuth, email, password);
  };

  const registerEmail = async (email: string, password: string, displayName?: string) => {
    const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    if (displayName) await updateProfile(cred.user, { displayName });
    // 👇 No tocamos el rol aquí. `ensureUserProfile` creará el doc con approved:false.
  };

  const logout = async () => {
    await signOut(firebaseAuth);
  };

  const value = useMemo<AuthCtx>(
    () => ({ loading, user, profile, loginEmail, registerEmail, logout }),
    [loading, user, profile]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
};
