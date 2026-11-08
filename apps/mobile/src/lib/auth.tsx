import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase, type ProfileRow } from './supabase';

interface AuthState {
  session: Session | null;
  profile: ProfileRow | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile(data);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // Defer DB calls out of the auth callback (supabase-js recommendation).
      setTimeout(() => void loadProfile(next?.user.id), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const refreshProfile = useCallback(
    () => loadProfile(session?.user.id),
    [loadProfile, session?.user.id],
  );

  return (
    <AuthContext.Provider value={{ session, profile, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
