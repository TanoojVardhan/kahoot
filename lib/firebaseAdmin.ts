import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let _fs: Firestore | null = null;

function serviceAccount(): any | null {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  try {
    if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (raw) return JSON.parse(raw);
  } catch { throw new Error('Backup database not configured: FIREBASE_SERVICE_ACCOUNT_B64 is not valid'); }
  return null;
}

export const firebaseConfigured = () => !!(process.env.FIREBASE_SERVICE_ACCOUNT_B64 || process.env.FIREBASE_SERVICE_ACCOUNT);

export function fs(): Firestore {
  if (_fs) return _fs;
  const sa = serviceAccount();
  if (!sa) throw new Error('Backup database not configured (set FIREBASE_SERVICE_ACCOUNT_B64)');
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa) });
  _fs = getFirestore(app);
  return _fs;
}
