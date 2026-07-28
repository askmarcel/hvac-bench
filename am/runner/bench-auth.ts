/**
 * JWT bench Supabase — refresh automatique (TTL ~1h).
 * Compte autorisé : th1b4ut.dev@gmail.com uniquement.
 */
import { createClient } from '@supabase/supabase-js';

const DEFAULT_BENCH_EMAIL = 'th1b4ut.dev@gmail.com';
const FORBIDDEN_BENCH_EMAILS = new Set(['askmarcelapp@gmail.com']);

/** Marge de sécurité avant expiration Supabase (~1h). */
const TOKEN_MAX_AGE_MS = 45 * 60 * 1000;

let cachedToken: string | null = null;
let cachedAt = 0;

function supabaseUrl(): string | undefined {
  return process.env.AM_HARNESS_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function supabaseAnonKey(): string | undefined {
  return process.env.AM_HARNESS_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

function benchEmail(): string {
  return process.env.AM_HARNESS_BENCH_EMAIL ?? DEFAULT_BENCH_EMAIL;
}

export function isJwtExpiredError(message: string): boolean {
  return /token is expired|invalid JWT|invalid_credentials|auth_required/i.test(message);
}

export function invalidateHarnessTokenCache(): void {
  cachedToken = null;
  cachedAt = 0;
}

/** Régénère un JWT via signInWithPassword (compte bench dev uniquement). */
export async function refreshHarnessBearerToken(): Promise<string> {
  const email = benchEmail();
  if (FORBIDDEN_BENCH_EMAILS.has(email)) {
    throw new Error(`Compte interdit pour le bench : ${email}`);
  }

  const password = process.env.AM_HARNESS_BENCH_PASSWORD;
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();

  if (!password || !url || !anonKey) {
    const fallback = process.env.AM_HARNESS_BEARER_TOKEN;
    if (fallback) {
      console.warn('⚠️  Refresh JWT impossible (mot de passe/URL Supabase manquants) — token env utilisé tel quel.');
      return fallback;
    }
    throw new Error(
      'Refresh JWT requis : AM_HARNESS_BENCH_PASSWORD + AM_HARNESS_SUPABASE_URL + AM_HARNESS_SUPABASE_ANON_KEY',
    );
  }

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw error ?? new Error(`Connexion bench échouée pour ${email}`);
  }

  const token = data.session.access_token;
  process.env.AM_HARNESS_BEARER_TOKEN = token;
  cachedToken = token;
  cachedAt = Date.now();
  return token;
}

/** Token cache ≤45 min, sinon refresh. */
export async function getHarnessBearerToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedAt < TOKEN_MAX_AGE_MS) {
    return cachedToken;
  }
  return refreshHarnessBearerToken();
}
