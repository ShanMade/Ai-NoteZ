import { create } from "zustand";
import {
  getApps,
  initializeApp,
} from "@firebase/app";
import {
  GoogleAuthProvider,
  EmailAuthProvider,
  getAuth,
  getIdToken as firebaseGetIdToken,
  linkWithPopup,
  linkWithCredential,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "@firebase/auth";
import type { AccessTokenProvider } from "../recorder/api";

type AuthStatus = "loading" | "ready";

interface AuthState {
  user: User | null;
  status: AuthStatus;
  setupError: string | null;
  guestPreview: boolean;
  initialize: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  continueAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingConfig = Object.values(firebaseConfig).some((value) => !value);
const firebaseAuth = missingConfig
  ? null
  : getAuth(getApps().find((app) => app.name === "[DEFAULT]") ?? initializeApp(firebaseConfig));
let unsubscribe: (() => void) | undefined;

const getAccessToken: AccessTokenProvider = async () => {
  const user = firebaseAuth?.currentUser;
  if (!user) throw new Error("Sign in to continue.");
  return firebaseGetIdToken(user);
};

export function getAuthenticatedUserId(): string | null {
  return firebaseAuth?.currentUser?.uid ?? null;
}

declare global {
  interface Window {
    notezAuth?: { getIdToken: AccessTokenProvider };
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: "loading",
  guestPreview: false,
  setupError: missingConfig
    ? "Firebase is not configured. Add the VITE_FIREBASE_* values from frontend/.env.example."
    : null,
  initialize: () => {
    if (!firebaseAuth) {
      set({
        status: "ready",
        guestPreview: window.sessionStorage.getItem("notez-guest-preview") === "true",
      });
      return;
    }
    if (unsubscribe) return;
    window.notezAuth = { getIdToken: getAccessToken };
    unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      set({ user, status: "ready", guestPreview: false });
      window.sessionStorage.removeItem("notez-guest-preview");
    });
  },
  signInWithGoogle: async () => {
    const auth = firebaseAuth;
    if (!auth) throw new Error(get().setupError ?? "Firebase is not configured.");
    const provider = new GoogleAuthProvider();
    const currentUser = auth.currentUser;
    if (currentUser?.isAnonymous) await linkWithPopup(currentUser, provider);
    else await signInWithPopup(auth, provider);
  },
  signInWithEmail: async (email, password) => {
    const auth = firebaseAuth;
    if (!auth) throw new Error(get().setupError ?? "Firebase is not configured.");
    const currentUser = auth.currentUser;
    if (currentUser?.isAnonymous) {
      const credential = EmailAuthProvider.credential(email, password);
      await linkWithCredential(currentUser, credential);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  },
  createAccount: async (email, password) => {
    const auth = firebaseAuth;
    if (!auth) throw new Error(get().setupError ?? "Firebase is not configured.");
    const currentUser = auth.currentUser;
    if (currentUser?.isAnonymous) {
      const credential = EmailAuthProvider.credential(email, password);
      await linkWithCredential(currentUser, credential);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
  },
  resetPassword: async (email) => {
    const auth = firebaseAuth;
    if (!auth) throw new Error(get().setupError ?? "Firebase is not configured.");
    await sendPasswordResetEmail(auth, email);
  },
  continueAsGuest: async () => {
    if (!firebaseAuth) {
      window.sessionStorage.setItem("notez-guest-preview", "true");
      set({ guestPreview: true });
      return;
    }
    if (!firebaseAuth.currentUser) await signInAnonymously(firebaseAuth);
  },
  signOut: async () => {
    if (firebaseAuth) await firebaseSignOut(firebaseAuth);
    window.sessionStorage.removeItem("notez-guest-preview");
    set({ guestPreview: false });
  },
}));
