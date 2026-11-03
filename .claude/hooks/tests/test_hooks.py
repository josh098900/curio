"""Pipe-tests for the three guard hooks. Run from anywhere: python3 -I .claude/hooks/tests/test_hooks.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HOOKS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(HOOKS))
SCRATCH = tempfile.mkdtemp(prefix="curio-hooktest-")
SCRATCH_REAL = os.path.realpath(SCRATCH)
failures = 0


def run(script, payload, env_extra=None):
    env = dict(os.environ)
    env.update(env_extra or {})
    p = subprocess.run([sys.executable, "-I", script], input=json.dumps(payload),
                       capture_output=True, text=True, env=env)
    return p.returncode, p.stderr.strip()


def check(label, script, payload, expect, env_extra=None):
    global failures
    code, err = run(script, payload, env_extra)
    ok = code == expect
    failures += 0 if ok else 1
    verdict = "ok  " if ok else "FAIL"
    print(f"  {verdict} [{'block' if expect == 2 else 'allow'}] {label}" + ("" if ok else f"  -> exit {code} {err[:160]}"))


def bash(cmd, cwd=REPO):
    return {"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": cwd}


def tool(name, **kw):
    return {"tool_name": name, "tool_input": kw, "cwd": REPO}


# ---------------------------------------------------------------- env files
ENV = os.path.join(HOOKS, "protect_env_files.py")
print("protect_env_files.py")
for path, expect in [
    (f"{REPO}/.env", 2), (f"{REPO}/.env.local", 2), (f"{REPO}/apps/web/.env.production.local", 2),
    (f"{REPO}/supabase/functions/.env", 2), (f"{REPO}/config/prod.env", 2),
    (f"{REPO}/.env.example", 0), (f"{REPO}/docs/Data_dictionary.md", 0), (f"{REPO}/apps/web/next-env.d.ts", 0),
    (f"{REPO}/.envrc", 0), (f"{REPO}/src/environment.ts", 0),
]:
    check(f"Read {os.path.relpath(path, REPO)}", ENV, tool("Read", file_path=path), expect)
check("Edit .env.local", ENV, tool("Edit", file_path=f"{REPO}/.env.local", old_string="a", new_string="b"), 2)
check("Write .env.example", ENV, tool("Write", file_path=f"{REPO}/.env.example", content="X="), 0)
check("Grep path .env", ENV, tool("Grep", pattern="KEY", path=f"{REPO}/.env"), 2)
check("Grep glob .env*", ENV, tool("Grep", pattern="KEY", glob=".env*"), 2)
check("Grep glob **/.env.local", ENV, tool("Grep", pattern="KEY", glob="**/.env.local"), 2)
check("Grep whole repo", ENV, tool("Grep", pattern="KEY", path=REPO), 0)
check("Glob is not reading", ENV, tool("Glob", pattern="**/.env*"), 0)
for cmd, expect in [
    ("cat .env", 2), ("source ./.env.local", 2), ("cp .env.example .env", 2), ("echo X=1 >> .env.local", 2),
    ("echo X=1 >>.env.local", 2), ("export $(cat .env | xargs)", 2), ("cat .env*", 2),
    ("node -e \"require('fs').readFileSync('.env')\"", 2), ("python3 -c \"print(open('apps/web/.env').read())\"", 2),
    ("supabase functions serve --env-file supabase/functions/.env", 2), ("cat config/prod.env", 2),
    ("git add .env && git commit -m 'x'", 2), ("git commit -m 'x' && cat .env", 2),
    ("cat .env.example", 0), ("node -e \"console.log(process.env.FOO)\"", 0), ("grep -r NEXT_PUBLIC apps/web", 0),
    ("ls -la", 0), ("cat apps/web/next-env.d.ts", 0), ("pnpm dev", 0),
    ("git commit -m 'Ignore .env files'", 0), ("git commit -m \"$(cat <<'EOF'\nAdd .env to .gitignore\nEOF\n)\"", 0),
    ("echo $NODE_ENV", 0), ("vite --mode production # import.meta.env", 0),
    ("deno eval 'console.log(Deno.env.toObject())'", 0), ("node -e 'console.log(import.meta.env)'", 0),
    ("cat ./staging.env", 2),
]:
    check(f"Bash: {cmd[:60]!r}", ENV, bash(cmd), expect)

# ---------------------------------------------------------------- production
PROD = os.path.join(HOOKS, "block_production.py")
print("block_production.py, nothing listed yet (fail closed)")
for cmd, expect in [
    ("supabase start", 0), ("supabase db reset", 0), ("supabase test db", 0), ("supabase migration new init", 0),
    ("supabase gen types typescript --local > packages/contracts/src/db.ts", 0),
    ("supabase gen types --lang swift --local", 0), ("supabase functions serve", 0), ("supabase --version", 0),
    ("supabase db dump --local -f x.sql", 0), ("supabase db push --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres", 0),
    ("ls supabase", 0), ("cd supabase && ls", 0), ("grep -r foo supabase functions", 0),
    ("supabase link --project-ref abcdefghijklmnopqrst", 2), ("supabase db push", 2), ("npx supabase db push", 2),
    ("supabase gen types typescript --linked", 2), ("supabase functions deploy dispatcher", 2),
    ("supabase secrets set X=1", 2), ("pnpm exec supabase migration list", 2), ("supabase db reset --linked", 2),
    ("vercel --prod", 2), ("npx vercel deploy --prod", 2), ("vercel promote https://x.vercel.app", 2),
    ("vercel env add STRIPE_KEY production", 2), ("vercel deploy", 0), ("vercel env ls preview", 0),
    ("psql $PROD_DATABASE_URL -c 'select 1'", 2), ("psql \"${PRODUCTION_DB_URL}\"", 2), ("echo $PRODUCT_ID", 0),
    ("stripe customers list --live", 2), ("curl -u sk_live_abc123: https://api.stripe.com/v1/charges", 2),
    ("stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook", 0), ("stripe trigger identity.verification_session.verified", 0),
    ("gh workflow run deploy-production.yml", 2), ("gh secret set STRIPE_KEY --env production", 2),
    ("gh pr create --title 'Production readiness'", 0), ("gh pr list", 0), ("git push origin main", 0),
    # The CLI installed as a pnpm dev dependency, and launchers with flags before the CLI name
    ("pnpm supabase start", 0), ("pnpm -w supabase test db", 0), ("pnpm supabase db reset", 0),
    ("pnpm supabase gen types --lang typescript --local", 0), ("pnpm add -D -w supabase", 0),
    ("pnpm --filter web add supabase", 0), ("echo supabase db push", 0), ("npx --package supabase supabase start", 0),
    ("pnpm -w supabase db push", 2), ("pnpm --filter web exec supabase db push", 2),
    ("pnpm --filter=web exec supabase db push", 2), ("npm -w web exec supabase db push", 2),
    ("npx supabase@2 db push", 2), ("pnpm dlx supabase@latest link --project-ref abcdefghijklmnopqrst", 2),
    ("/usr/bin/env supabase db push", 2), ("xargs supabase db push --linked", 2),
    ("npx --package supabase supabase db push", 2), ("pnpm dlx vercel@latest --prod", 2),
    ("pnpm --filter web exec vercel deploy --prod", 2),
    # CLI v3 targets the local stack by default and a remote project with --remote
    ("supabase test db --remote", 2), ("pnpm supabase test db --remote=abcdefghijklmnopqrst", 2),
    ("supabase db reset --remote", 2), ("supabase db lint --remote", 2),
    ("supabase test db --remote=postgresql://postgres:postgres@127.0.0.1:54322/postgres", 0),
    ("supabase unlink", 0), ("supabase --log-level debug start", 0),
    ("pnpm supabase gen types --lang typescript > packages/contracts/src/database.ts", 0),
    ("pnpm supabase gen types --lang swift", 0), ("pnpm supabase gen types --remote", 2),
    ("supabase gen types --project-id abcdefghijklmnopqrst", 2),
    # Help never touches a project, and shell redirections aren't arguments
    ("supabase link --help", 0), ("pnpm supabase db push --help 2>&1", 0), ("supabase --help 2>&1 | head", 0),
    ("supabase --version 2>/dev/null", 0), ("supabase start > /dev/null 2>&1", 0),
    ("2>/dev/null supabase db push", 2), ("supabase db push 2>&1 | tail", 2),
    # Shell forms: line continuations, keywords, nested shells, and other words before the name
    ("pnpm supabase db reset \\\n  --remote --yes", 2), ("supa\\\nbase db push", 2),
    ("for f in verification dispatcher; do pnpm supabase functions deploy \"$f\" --yes; done", 2),
    ("if true; then pnpm supabase db push --remote --yes; fi", 2), ("bash -lc 'pnpm supabase db push --remote'", 2),
    ("sh -c \"supabase link --project-ref abcdefghijklmnopqrst\"", 2), ("eval 'supabase db push --remote'", 2),
    ("dotenvx run -- supabase db push --remote", 2), ("pnpm exec SUPABASE db push", 2),
    ("bash -lc 'pnpm supabase start'", 0), ("npm view supabase versions", 0), ("pnpm why supabase", 0),
    ("pnpm update supabase --latest", 0), ("grep -rn 'supabase db push' .claude", 0),
    # Help counts only on its own; other CLI versions and commands that print secrets are refused
    ("pnpm supabase secrets unset STRIPE_KEY -- --help", 2), ("pnpm supabase db reset --remote --yes --sql-paths --help", 2),
    ("npx supabase@2 gen keys", 2), ("npx supabase@2 gen types typescript", 2), ("pnpm dlx supabase@3.0.0 start", 0),
    ("supabase gen keys", 2), ("pnpm supabase projects api-keys --remote --reveal", 2),
    ("supabase db push --db-url 'postgresql://postgres:pw@127.0.0.1,db.example.com/postgres'", 2),
    ("supabase db push --db-url 'postgresql://postgres@localhost/postgres?host=db.example.com'", 2),
    # Other CLIs: Stripe live mode, Vercel removals, and approving deployments through gh
    ("stripe customers list --live=true", 2), ("vercel remove my-app-abc123.vercel.app --yes", 2),
    ("vercel project rm curio", 2),
    ("gh api -X POST repos/o/r/actions/runs/123/pending_deployments -F 'environment_ids[]=1' -f state=approved", 2),
    ("gh api -X PUT repos/o/r/environments/staging -f wait_timer=0", 2), ("gh api repos/o/r/pulls", 0),
    # From the second security review: unparseable lines, comment continuations and other routes to approval
    ("cd apps/web && vercel deploy --prod # it's ready", 2),
    ("cd . && pnpm supabase functions deploy --project-ref abcdefghijklmnopqrst # it's staging", 2),
    ("bash -c 'echo start\npnpm supabase db reset --yes --remote'", 2), ("echo hi # \\\nsupabase db push --linked", 2),
    ("gh api graphql -f query='mutation{approveDeployments(input:{}){clientMutationId}}'", 2),
    ("curl -X POST https://api.github.com/repos/o/r/actions/runs/1/pending_deployments -d '{}'", 2),
    ("pnpm supabase functions deploy --help=false", 2), ("supabase secrets set X=1 -h=false", 2),
    ("supabase db push --local=false", 2), ("supabase db push --help", 0), ("vercel projects rm curio", 2),
    ("supabase db push --db-url 'postgresql://u@[1.2.3.4]:5432/postgres'", 2),
    ("bash <<'EOF'\nsupabase db push --remote\nEOF", 2), ("echo \"$(pnpm supabase db push --remote)\"", 2),
    ("echo \"`supabase db push --remote`\"", 2), ("fish -c 'supabase db push --remote'", 2),
    # Everyday commands that must stay allowed
    ("find supabase -name '*.sql'", 0), ("fd . supabase -e sql", 0), ("pnpm ls supabase --depth 0", 0),
    ("pnpm add supabase -D --filter web", 0), ("pnpm add -D supabase@latest -E", 0),
    ("git commit -F - <<'EOF'\nRuns supabase db push on staging\nEOF", 0), ("pnpm supabase stop", 0),
    ("pnpm supabase migration new add_profiles", 0), ("pnpm supabase functions serve", 0), ("pnpm install", 0),
]:
    check(f"Bash: {cmd[:60]!r}", PROD, bash(cmd), expect)
check("MCP supabase tool, nothing listed", PROD, {"tool_name": "mcp__supabase__execute_sql", "tool_input": {"project_id": "x", "query": "select 1"}}, 2)
check("MCP Notion tool", PROD, {"tool_name": "mcp__claude_ai_Notion__notion-search", "tool_input": {"query": "production plan"}}, 0)

print("block_production.py, with a production ref listed")
PRODREF, STAGEREF = "prodrefaaaaaaaaaaaaa", "stagerefbbbbbbbbbbbb"
sandbox = os.path.join(SCRATCH_REAL, "hooktest_prod")
os.makedirs(os.path.join(sandbox, "hooks"))
shutil.copy(PROD, os.path.join(sandbox, "hooks", "block_production.py"))
with open(os.path.join(sandbox, "hooks", "production-targets.txt"), "w") as f:
    f.write(f"# test\n{PRODREF}\ncurio.example\n")
PROD2 = os.path.join(sandbox, "hooks", "block_production.py")
proj = os.path.join(sandbox, "project")
os.makedirs(os.path.join(proj, "supabase", ".temp"))
ref_file = os.path.join(proj, "supabase", ".temp", "project-ref")


def linked(ref):
    with open(ref_file, "w") as f:
        f.write(ref)


env = {"CLAUDE_PROJECT_DIR": proj}
linked(STAGEREF)
check("linked staging: supabase db push", PROD2, bash("supabase db push", proj), 0, env)
check("linked staging: pnpm supabase db push", PROD2, bash("pnpm supabase db push", proj), 0, env)
check("linked staging: supabase functions deploy", PROD2, bash("supabase functions deploy", proj), 0, env)
check("linked staging: link staging explicitly", PROD2, bash(f"supabase link --project-ref {STAGEREF}", proj), 0, env)
check("link production explicitly", PROD2, bash(f"supabase link --project-ref {PRODREF}", proj), 2, env)
check("psql to the production pooler", PROD2, bash(f"psql postgresql://postgres.{PRODREF}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres", proj), 2, env)
check("curl the production domain", PROD2, bash("curl https://curio.example/api/health", proj), 2, env)
check("subdirectory, linked staging", PROD2, bash("supabase db push", os.path.join(proj, "supabase")), 0, env)
other = os.path.join(sandbox, "other")
os.makedirs(os.path.join(other, "supabase", ".temp"))
with open(os.path.join(other, "supabase", ".temp", "project-ref"), "w") as f:
    f.write(PRODREF)
check("linked staging: --workdir to a production checkout", PROD2, bash(f"supabase db push --remote --workdir {other}", proj), 2, env)
check("linked staging: cd to a production checkout", PROD2, bash(f"cd {other} && supabase db push --remote", proj), 2, env)
check("linked staging: SUPABASE_WORKDIR to a production checkout", PROD2, bash(f"SUPABASE_WORKDIR={other} supabase db push --remote", proj), 2, env)
check("linked staging: cd inside bash -c", PROD2, bash(f"bash -c 'cd {other} && supabase db push --remote'", proj), 2, env)
check("linked staging: cd through a variable", PROD2, bash("cd \"$DIR\" && supabase db push --remote", proj), 2, env)
check("linked staging: target in a variable", PROD2, bash("supabase db push --remote=\"$REF\"", proj), 2, env)
check("linked staging: staging ref given explicitly", PROD2, bash(f"supabase db push --remote={STAGEREF}", proj), 0, env)
check("linked staging: bash -lc", PROD2, bash("bash -lc 'supabase db push --remote'", proj), 0, env)
check("linked staging: printing the keys", PROD2, bash("pnpm supabase projects api-keys --remote --reveal", proj), 2, env)
check("linked staging: pushd to a production checkout", PROD2, bash(f"pushd {other} && supabase db push --remote", proj), 2, env)
check("linked staging: cd -P", PROD2, bash(f"cd -P {other} && supabase db push --remote", proj), 2, env)
check("linked staging: if cd", PROD2, bash(f"if cd {other}; then supabase db push --remote; fi", proj), 2, env)
check("linked staging: a { cd; } group", PROD2, bash(f"{{ cd {other}; supabase db push --remote; }}", proj), 2, env)
check("linked staging: pnpm -C", PROD2, bash(f"pnpm -C {other} exec supabase db push --remote", proj), 2, env)
check("linked staging: npm --prefix", PROD2, bash(f"npm --prefix {other} exec supabase db push --remote", proj), 2, env)
check("linked staging: SUPABASE_* from a variable", PROD2, bash("SUPABASE_PROJECT_ID=$X supabase db push --remote", proj), 2, env)
check("linked staging: production ref split by quotes", PROD2, bash(f"supabase functions deploy --project-ref {PRODREF[:7]}''{PRODREF[7:]}", proj), 2, env)
check("linked staging: target from xargs", PROD2, bash("echo x | xargs -I{} supabase db push --project-ref {}", proj), 2, env)
check("linked staging: a branch of the linked project", PROD2, bash("supabase db push --remote=feature-x", proj), 0, env)
linked(PRODREF)
check("linked production: line continuation", PROD2, bash("pnpm supabase db reset \\\n  --remote --yes", proj), 2, env)
check("linked production: bash -lc", PROD2, bash("bash -lc 'supabase db push --remote'", proj), 2, env)
check("linked production: a deploy loop", PROD2, bash("for f in verification dispatcher; do pnpm supabase functions deploy \"$f\"; done", proj), 2, env)
check("linked production: a branch of it", PROD2, bash("supabase db push --remote=feature-x", proj), 2, env)
check("linked production: --remote=false", PROD2, bash("supabase db push --remote=false", proj), 2, env)
check("linked production: supabase db push", PROD2, bash("supabase db push", proj), 2, env)
check("linked production: pnpm -w supabase db push", PROD2, bash("pnpm -w supabase db push", proj), 2, env)
check("linked production: supabase test db --remote", PROD2, bash("supabase test db --remote", proj), 2, env)
check("linked production: from a subdirectory", PROD2, bash("supabase migration list", os.path.join(proj, "supabase")), 2, env)
check("linked production: local commands still fine", PROD2, bash("supabase db reset && supabase test db", proj), 0, env)
check("MCP call naming production", PROD2, {"tool_name": "mcp__supabase__execute_sql", "tool_input": {"project_id": PRODREF}}, 2, env)
check("MCP call naming staging", PROD2, {"tool_name": "mcp__supabase__execute_sql", "tool_input": {"project_id": STAGEREF}}, 0, env)

# ---------------------------------------------------------------- migrations
MIG = os.path.join(HOOKS, "protect_applied_migrations.py")
print("protect_applied_migrations.py")
repo = os.path.join(SCRATCH_REAL, "hooktest_repo")
mig_dir = os.path.join(repo, "supabase", "migrations")
os.makedirs(mig_dir)
subprocess.run(["git", "init", "-q", "-b", "main", repo], check=True)
applied = os.path.join(mig_dir, "20261109000000_init.sql")
with open(applied, "w") as f:
    f.write("create schema private;\n")
subprocess.run(["git", "-C", repo, "add", "."], check=True)
subprocess.run(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], check=True)
fresh = os.path.join(mig_dir, "20261116000000_rate_limits.sql")
with open(fresh, "w") as f:
    f.write("-- new\n")


def mtool(name, **kw):
    return {"tool_name": name, "tool_input": kw, "cwd": repo}


check("Edit applied migration", MIG, mtool("Edit", file_path=applied, old_string="a", new_string="b"), 2)
check("Write applied migration", MIG, mtool("Write", file_path=applied, content="x"), 2)
check("Edit uncommitted migration", MIG, mtool("Edit", file_path=fresh, old_string="a", new_string="b"), 0)
check("Write a new migration", MIG, mtool("Write", file_path=os.path.join(mig_dir, "20261117000000_x.sql"), content="x"), 0)
check("Edit a seed file", MIG, mtool("Edit", file_path=os.path.join(repo, "supabase", "seed.sql"), old_string="a", new_string="b"), 0)
if SCRATCH != SCRATCH_REAL:
    check("Edit through a symlinked path", MIG, mtool("Edit", file_path=applied.replace(SCRATCH_REAL, SCRATCH), old_string="a", new_string="b"), 2)
for cmd, expect in [
    ("cat supabase/migrations/20261109000000_init.sql", 0), ("sed -n 1,5p supabase/migrations/20261109000000_init.sql", 0),
    ("grep -n schema supabase/migrations/*.sql", 0), ("ls supabase/migrations", 0), ("git diff supabase/migrations", 0),
    ("supabase db reset", 0), ("find supabase/migrations -name '*.sql'", 0), ("mv supabase/migrations/20261116000000_rate_limits.sql supabase/migrations/20261116000001_rate_limits.sql", 0),
    ("rm supabase/migrations/20261109000000_init.sql", 2), ("sed -i '' 's/a/b/' supabase/migrations/20261109000000_init.sql", 2),
    ("perl -pi -e 's/a/b/' supabase/migrations/20261109000000_init.sql", 2), ("echo x >> supabase/migrations/20261109000000_init.sql", 2),
    ("echo x > supabase/migrations/20261109000000_init.sql", 2), ("rm supabase/migrations/*", 2), ("rm -rf supabase", 2),
    ("cd supabase/migrations && rm 20261109000000_init.sql", 2), ("cd supabase/migrations && rm *.sql", 2),
    ("git rm supabase/migrations/20261109000000_init.sql", 2), ("find supabase/migrations -name '*.sql' -delete", 2),
    ("ls supabase/migrations/*.sql | xargs rm", 2), ("cat x.sql | tee supabase/migrations/20261109000000_init.sql", 2),
]:
    check(f"Bash: {cmd[:60]!r}", MIG, bash(cmd, repo), expect)
print("protect_applied_migrations.py, on an unmerged feature branch")
subprocess.run(["git", "-C", repo, "checkout", "-q", "-b", "feature"], check=True)
branch_only = os.path.join(mig_dir, "20261118000000_feature.sql")
with open(branch_only, "w") as f:
    f.write("-- committed on the branch only\n")
subprocess.run(["git", "-C", repo, "add", "."], check=True)
subprocess.run(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "feature"], check=True)
check("Edit a migration committed only on the branch", MIG, mtool("Edit", file_path=branch_only, old_string="a", new_string="b"), 0)
check("rm a migration committed only on the branch", MIG, bash("rm supabase/migrations/20261118000000_feature.sql", repo), 0)
check("Edit the migration that's in main, from the branch", MIG, mtool("Edit", file_path=applied, old_string="a", new_string="b"), 2)
subprocess.run(["git", "-C", repo, "checkout", "-q", "main"], check=True)
subprocess.run(["git", "-C", repo, "merge", "-q", "feature"], check=True)
check("Edit the same migration once merged into main", MIG, mtool("Edit", file_path=branch_only, old_string="a", new_string="b"), 2)
check("real repo: a migration that isn't in main can be edited", MIG,
      {"tool_name": "Edit", "tool_input": {"file_path": f"{REPO}/supabase/migrations/20261109000000_init.sql"}, "cwd": REPO}, 0)

shutil.rmtree(SCRATCH, ignore_errors=True)
print("\nFAILURES:", failures)
sys.exit(1 if failures else 0)
