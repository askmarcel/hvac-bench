#!/usr/bin/env bash
# Configure les secrets GitHub AM pour askmarcel/hvac-bench.
#
# Prérequis : gh auth login, accès repo askmarcel/hvac-bench
#
# Usage :
#   export OPENROUTER_API_KEY=sk-or-v1-…        # ou déjà dans AskMarcel-WebApp-NextJS/.env
#   export AM_HARNESS_BENCH_PASSWORD=…          # après create-am-harness-bearer-token.ts --init-password (compte th1b4ut.dev@gmail.com uniquement)
#   ./scripts/setup-am-github-secrets.sh
#
# Optionnel : source automatique depuis la WebApp
#   WEBAPP_ENV=../AskMarcel-WebApp-NextJS/.env ./scripts/setup-am-github-secrets.sh

set -euo pipefail

REPO="${GITHUB_REPO:-askmarcel/hvac-bench}"
WEBAPP_DIR="${WEBAPP_DIR:-../AskMarcel-WebApp-NextJS}"

load_env_var() {
  local file="$1" key="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^["'\'']//;s/["'\'']$//'
}

if [[ -n "${WEBAPP_ENV:-}" && -f "$WEBAPP_ENV" ]]; then
  OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-$(load_env_var "$WEBAPP_ENV" OPENROUTER_API_KEY)}"
  NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-$(load_env_var "$WEBAPP_ENV" NEXT_PUBLIC_SUPABASE_URL)}"
  NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$(load_env_var "$WEBAPP_ENV" NEXT_PUBLIC_SUPABASE_ANON_KEY)}"
elif [[ -f "$WEBAPP_DIR/.env" ]]; then
  OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-$(load_env_var "$WEBAPP_DIR/.env" OPENROUTER_API_KEY)}"
  NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-$(load_env_var "$WEBAPP_DIR/.env" NEXT_PUBLIC_SUPABASE_URL)}"
  NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$(load_env_var "$WEBAPP_DIR/.env" NEXT_PUBLIC_SUPABASE_ANON_KEY)}"
fi

OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
if [[ -z "$OPENROUTER_API_KEY" ]]; then
  echo "❌ OPENROUTER_API_KEY manquant (export ou WEBAPP_ENV=…/.env)" >&2
  exit 1
fi

# Modèles épinglés (preregistration-am.md) — 3 rôles distincts
AM_SIM_MODEL="${AM_SIM_MODEL:-google/gemini-2.5-flash}"
AM_JUDGE_MODEL="${AM_JUDGE_MODEL:-mistralai/mistral-large-2512}"
AM_HARNESS_MODEL_ID="${AM_HARNESS_MODEL_ID:-fast-marcel}"
AM_HARNESS_URL="${AM_HARNESS_URL:-https://app.askmarcel.app/api/mobile/chat}"

echo "→ Secrets non sensibles (repo: $REPO)"
gh secret set AM_SIM_MODEL --body "$AM_SIM_MODEL" --repo "$REPO"
gh secret set AM_JUDGE_MODEL --body "$AM_JUDGE_MODEL" --repo "$REPO"
gh secret set AM_HARNESS_MODEL_ID --body "$AM_HARNESS_MODEL_ID" --repo "$REPO"
gh secret set AM_HARNESS_URL --body "$AM_HARNESS_URL" --repo "$REPO"

echo "→ Clés OpenRouter (fallback partagé + clés dédiées sim/juge)"
gh secret set OPENROUTER_API_KEY --body "$OPENROUTER_API_KEY" --repo "$REPO"
gh secret set AM_SIM_API_KEY --body "$OPENROUTER_API_KEY" --repo "$REPO"
gh secret set AM_JUDGE_API_KEY --body "$OPENROUTER_API_KEY" --repo "$REPO"

if [[ -n "${AM_HARNESS_BENCH_PASSWORD:-}" ]]; then
  echo "→ Mot de passe compte bench (régénération JWT en CI)"
  gh secret set AM_HARNESS_BENCH_PASSWORD --body "$AM_HARNESS_BENCH_PASSWORD" --repo "$REPO"
fi

if [[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
  gh secret set AM_HARNESS_SUPABASE_URL --body "$NEXT_PUBLIC_SUPABASE_URL" --repo "$REPO"
fi
if [[ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]]; then
  gh secret set AM_HARNESS_SUPABASE_ANON_KEY --body "$NEXT_PUBLIC_SUPABASE_ANON_KEY" --repo "$REPO"
fi
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(load_env_var "$WEBAPP_DIR/.env" SUPABASE_SERVICE_ROLE_KEY 2>/dev/null || true)}"
if [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "→ Service role Supabase (harnais in-process CI)"
  gh secret set AM_HARNESS_SUPABASE_SERVICE_ROLE_KEY --body "$SUPABASE_SERVICE_ROLE_KEY" --repo "$REPO"
fi

if [[ -f "$WEBAPP_DIR/scripts/create-am-harness-bearer-token.ts" ]]; then
  if [[ -n "${AM_HARNESS_BENCH_PASSWORD:-}" ]]; then
    echo "→ JWT bench (court terme — la CI le régénère si AM_HARNESS_BENCH_PASSWORD est défini)"
    TOKEN="$(cd "$WEBAPP_DIR" && pnpm exec tsx scripts/create-am-harness-bearer-token.ts)"
    gh secret set AM_HARNESS_BEARER_TOKEN --body "$TOKEN" --repo "$REPO"
  else
    echo "⚠️  AM_HARNESS_BENCH_PASSWORD absent — AM_HARNESS_BEARER_TOKEN non mis à jour."
    echo "    Lancer : cd $WEBAPP_DIR && pnpm exec tsx scripts/create-am-harness-bearer-token.ts --init-password"
  fi
fi

echo ""
echo "✅ Secrets AM configurés. Vérifier : gh secret list --repo $REPO"
echo ""
echo "⚠️  Sur la WebApp prod, ALLOW_BENCH_MODE=true est requis pour que x-bench-mode soit honoré."
echo "    Sinon utiliser une URL de preview/staging avec ce flag."
