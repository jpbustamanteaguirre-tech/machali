// src/utils/storage.ts
import { doc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadString } from 'firebase/storage';
import '../services/firebase';
import { db } from '../services/firebase';

function parseDataUrlOrBase64(input: string): { base64: string; mime: string } {
  if (input?.startsWith('data:')) {
    const m = input.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) throw new Error('upload: dataURL inválido');
    const [, mime, b64] = m;
    return { base64: b64, mime };
  }
  return { base64: String(input ?? ''), mime: 'image/jpeg' };
}

/**
 * Intenta subir a Storage. Si falla (p.ej. “creating blobs from arraybuffer…” en Expo),
 * devuelve el MISMO dataURL para que lo guardes en Firestore (fallback).
 */
export async function uploadProfileDataURL(uid: string, dataOrBase64: string): Promise<string> {
  if (!uid) throw new Error('uploadProfileDataURL: uid requerido');

  try {
    const { base64, mime } = parseDataUrlOrBase64(dataOrBase64);
    const storage = getStorage();
    const objectRef = ref(storage, `users/${uid}/profile.jpg`);
    await uploadString(objectRef, base64, 'base64', { contentType: mime });
    return await getDownloadURL(objectRef);
  } catch (e: any) {
    // 🔁 Fallback: guarda el dataURL directo en el doc del usuario
    const dataURL = dataOrBase64.startsWith('data:')
      ? dataOrBase64
      : `data:image/jpeg;base64,${dataOrBase64}`;
    await updateDoc(doc(db, 'users', uid), { photoURL: dataURL });
    return dataURL;
  }
}

export async function uploadAthleteDataURL(athleteId: string, dataOrBase64: string): Promise<string> {
  if (!athleteId) throw new Error('uploadAthleteDataURL: athleteId requerido');

  try {
    const { base64, mime } = parseDataUrlOrBase64(dataOrBase64);
    const storage = getStorage();
    const objectRef = ref(storage, `athletes/${athleteId}/profile.jpg`);
    await uploadString(objectRef, base64, 'base64', { contentType: mime });
    return await getDownloadURL(objectRef);
  } catch (e: any) {
    const dataURL = dataOrBase64.startsWith('data:')
      ? dataOrBase64
      : `data:image/jpeg;base64,${dataOrBase64}`;
    await updateDoc(doc(db, 'athletes', athleteId), { photoURL: dataURL });
    return dataURL;
  }
}
