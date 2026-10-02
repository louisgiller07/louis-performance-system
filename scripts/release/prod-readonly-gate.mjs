// UX-11R.3.2 — read-only production gate tooling (no secret in this file).
//
// Run by the OPERATOR from their own terminal; the password never goes
// through a file, a script argument or a log:
//
//   $env:PGPASSWORD = Read-Host -AsSecureString ...   (or any shell equivalent)
//   node scripts/release/prod-readonly-gate.mjs inspect --out <DIR_OUTSIDE_REPO>
//   node scripts/release/prod-readonly-gate.mjs catalog --target local:<db container> --out <FILE>
//   node scripts/release/prod-readonly-gate.mjs drift --prod <catalog> --ref <catalog> --out <FILE>
//   node scripts/release/prod-readonly-gate.mjs backup --out <DIR_OUTSIDE_REPO>
//   node scripts/release/prod-readonly-gate.mjs restore-check --backup <DIR> --into local:<db container>
//
// Target "production" (default): the project linked in supabase/.temp, which
// MUST be uvolpldwwyvadlamulvr (never evynmzyjhobdpmxdiwsy), reached through
// the session pooler of supabase/.temp/pooler-url with PGPASSWORD from the
// environment (passed to docker by name only, never by value).
// Target "local:<container>": a LOCAL Supabase db container (tests,
// reference schema, restore rehearsal). Never another host.
//
// Read-only guarantees on the target:
//   - every SQL statement runs inside BEGIN READ ONLY … ROLLBACK, with
//     ON_ERROR_STOP: PostgreSQL itself refuses any write;
//   - dumps use pg_dump, which only reads (REPEATABLE READ, READ ONLY snapshot);
//   - no role, no DDL, no Supabase CLI login role, no Management API call.
// psql / pg_dump / pg_restore run inside the local container
// supabase_db_louis-performance-system (PostgreSQL 17 client tools).
// Outputs: counts, structural catalog lines, hashes, dump files — never row
// content in the console; dump files are written outside the repository.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRODUCTION_REF = "uvolpldwwyvadlamulvr";
const FORBIDDEN_REFS = ["evynmzyjhobdpmxdiwsy"];
const RUNNER = "supabase_db_louis-performance-system";
const PRODUCTION_BASE = "ba59239";
const EXPECTED_PENDING = [
  "20260930120000_ux11b2_execution_schema",
  "20260930120500_ux11b2_record_session_execution",
  "20260930130000_ux11a5a2b_dh_technical_tier",
  "20261001090000_ux11b23_pass_measure_contract",
  "20261001120000_ux11a5c2_v2_daily_persistence",
  "20261001140000_ux11b25_session_activity_results",
  "20261002090000_ux11b26_execution_result_integrity",
  "20261002120000_ux11r1_athlete_account_purge",
  "20261003090000_ux11r2_training_plan_model_assignments",
  "20261003120000_ux11r31_revoke_direct_athlete_delete",
];

const [command, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];

function fail(message) {
  console.error(`\nprod-readonly-gate: STOP — ${message}`);
  process.exit(1);
}
const sha256File = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const nowUtc = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

function outsideRepo(path) {
  const abs = resolve(path);
  const rel = relative(ROOT, abs);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) fail(`${abs} is inside the repository: outputs must stay outside git`);
  return abs;
}

// ---------- target resolution ----------
function resolveTarget(spec = "production") {
  if (spec.startsWith("local:")) {
    const container = spec.slice("local:".length);
    if (!/^supabase_db_[A-Za-z0-9_.-]+$/.test(container)) fail(`local target must be a supabase_db_* container, got "${container}"`);
    return { kind: "local", label: spec, container, conninfo: "dbname=postgres user=postgres" };
  }
  if (spec !== "production") fail(`unknown target "${spec}"`);
  const ref = readFileSync(join(ROOT, "supabase", ".temp", "project-ref"), "utf8").trim();
  if (FORBIDDEN_REFS.includes(ref)) fail(`linked project is the forbidden ${ref}`);
  if (ref !== PRODUCTION_REF) fail(`linked project ${ref} is not ${PRODUCTION_REF}`);
  const url = new URL(readFileSync(join(ROOT, "supabase", ".temp", "pooler-url"), "utf8").trim());
  const user = decodeURIComponent(url.username);
  if (url.password) fail("pooler-url unexpectedly carries a password; refusing to use it");
  if (!user.endsWith(`.${PRODUCTION_REF}`)) fail(`pooler user does not belong to ${PRODUCTION_REF}`);
  if (!process.env.PGPASSWORD) fail("PGPASSWORD is not set in this terminal (its value is never printed)");
  const conninfo = `host=${url.hostname} port=${url.port || 5432} user=${user} dbname=${url.pathname.replace(/^\//, "") || "postgres"} sslmode=require`;
  return { kind: "production", label: `production ${PRODUCTION_REF}`, container: RUNNER, conninfo };
}

function dockerArgs(target, tool, toolArgs, { superuser = false } = {}) {
  const env = target.kind === "production" ? ["-e", "PGPASSWORD"] : [];
  const conninfo = superuser ? target.conninfo.replace("user=postgres", "user=supabase_admin") : target.conninfo;
  return ["exec", "-i", ...env, target.container, tool, ...toolArgs, ...(tool === "pg_restore" ? ["--dbname", conninfo] : [conninfo])];
}

/** Superuser SQL on a LOCAL throwaway container only (restore rehearsal). Refuses production. */
function localSuperSql(target, sql) {
  if (target.kind !== "local") fail("superuser SQL is only allowed on a local throwaway container");
  const r = spawnSync("docker", ["exec", "-i", target.container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres", "-f", "-"], { input: sql, encoding: "utf8" });
  if (r.status !== 0) fail(`local superuser SQL failed: ${(r.stderr || "").split("\n")[0]}`);
}

/** Read-only SQL: wrapped in BEGIN READ ONLY … ROLLBACK, ON_ERROR_STOP, unaligned `|` output. */
function readOnlySql(target, sql) {
  const r = spawnSync("docker", dockerArgs(target, "psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|", "-f", "-"]), {
    input: `BEGIN READ ONLY;\n${sql}\nROLLBACK;\n`,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) fail(`read-only query failed on ${target.label}: ${(r.stderr || "").split("\n")[0]}`);
  return r.stdout.replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
}

function pgDumpToFile(target, args, file) {
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, "w");
  const r = spawnSync("docker", dockerArgs(target, "pg_dump", args), { stdio: ["ignore", fd, "pipe"], maxBuffer: 64 * 1024 * 1024 });
  closeSync(fd);
  if (r.status !== 0) fail(`pg_dump failed on ${target.label}: ${String(r.stderr).split("\n")[0]}`);
  return { file, bytes: statSync(file).size, sha256: sha256File(file) };
}

// ---------- queries ----------
const MIGRATIONS_SQL = "select to_jsonb(m) ->> 'version', coalesce(to_jsonb(m) ->> 'name', '') from supabase_migrations.schema_migrations m order by 1;";

const ATHLETES_GRANTS_SQL = `
select 'grant|' || grantee || '|' || privs from (
  select coalesce(r.rolname::text, 'PUBLIC') as grantee, string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
  from pg_class c, aclexplode(c.relacl) a left join pg_roles r on r.oid = a.grantee
  where c.oid = 'public.athletes'::regclass group by 1
) g order by 1;
select 'rls|' || relrowsecurity || '|force=' || relforcerowsecurity from pg_class where oid = 'public.athletes'::regclass;
select 'policy|' || polname || '|cmd=' || polcmd::text || '|permissive=' || polpermissive || '|roles=' || coalesce((select string_agg(coalesce(rolname, 'PUBLIC'), ',' order by rolname) from unnest(polroles) x left join pg_roles on pg_roles.oid = x), '')
from pg_policy where polrelid = 'public.athletes'::regclass order by 1;`;

// Counts only (never row content). Tables the connected role cannot read are reported, not skipped silently.
const COUNTS_SQL = `
select n.nspname || '.' || c.relname || '|' ||
  case when has_table_privilege(c.oid, 'SELECT')
       then (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
       else 'NO_SELECT_PRIVILEGE' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and (n.nspname = 'public' or (n.nspname, c.relname) in (('auth', 'users'), ('auth', 'identities'), ('storage', 'buckets'), ('storage', 'objects'), ('supabase_migrations', 'schema_migrations')))
  and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
order by 1;`;

// Structural catalog of schema public: one sorted line per material fact. Owners excluded (normalised).
const CATALOG_SQL = `
with ext as (select objid from pg_depend where deptype = 'e'),
rel as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.oid not in (select objid from ext)
),
fn as (
  select p.oid, p.proname, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.oid not in (select objid from ext)
),
rolename as (select 0::oid as oid, 'PUBLIC'::text as name union all select oid, rolname::text from pg_roles)
select line from (
  select 'schema_acl|public|' || coalesce((select string_agg(r.name || '=' || a.privilege_type, ',' order by r.name, a.privilege_type) from pg_namespace ns, aclexplode(ns.nspacl) a join rolename r on r.oid = a.grantee where ns.nspname = 'public'), 'default') as line
  union all select 'relation|' || relname || '|kind=' || relkind::text || '|rls=' || relrowsecurity || '|force=' || relforcerowsecurity from rel
  union all
  select 'column|' || rel.relname || '.' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|notnull=' || a.attnotnull
         || '|default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|identity=' || a.attidentity::text || '|generated=' || a.attgenerated::text
  from rel join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where rel.relkind in ('r', 'p', 'v', 'm', 'f')
  union all select 'constraint|' || rel.relname || '|' || con.conname || '|' || pg_get_constraintdef(con.oid) from rel join pg_constraint con on con.conrelid = rel.oid
  union all select 'index|' || rel.relname || '|' || pg_get_indexdef(i.indexrelid) from rel join pg_index i on i.indrelid = rel.oid
  union all select 'trigger|' || rel.relname || '|enabled=' || t.tgenabled::text || '|' || pg_get_triggerdef(t.oid) from rel join pg_trigger t on t.tgrelid = rel.oid and not t.tgisinternal
  union all
  select 'policy|' || rel.relname || '|' || p.polname || '|cmd=' || p.polcmd::text || '|permissive=' || p.polpermissive
         || '|roles=' || coalesce((select string_agg(r.name, ',' order by r.name) from unnest(p.polroles) x join rolename r on r.oid = x), '')
         || '|using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
  from rel join pg_policy p on p.polrelid = rel.oid
  union all
  select 'grant|' || rel.relname || '|' || coalesce((select string_agg(x, ';' order by x) from (select r.name || '=' || string_agg(a.privilege_type, ',' order by a.privilege_type) as x from aclexplode(rel.relacl) a join rolename r on r.oid = a.grantee group by r.name) g), 'default')
  from rel
  union all
  select 'column_grant|' || rel.relname || '.' || a.attname || '|' || (select string_agg(r.name || '=' || x.privilege_type, ',' order by r.name, x.privilege_type) from aclexplode(a.attacl) x join rolename r on r.oid = x.grantee)
  from rel join pg_attribute a on a.attrelid = rel.oid and a.attacl is not null
  union all select 'view|' || rel.relname || '|def_md5=' || md5(pg_get_viewdef(rel.oid)) from rel where rel.relkind in ('v', 'm')
  union all
  select 'sequence|' || rel.relname || '|' || format_type(s.seqtypid, null) || '|start=' || s.seqstart || '|inc=' || s.seqincrement || '|min=' || s.seqmin || '|max=' || s.seqmax || '|cycle=' || s.seqcycle
  from rel join pg_sequence s on s.seqrelid = rel.oid
  union all
  select 'function|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|kind=' || p.prokind::text || '|returns=' || coalesce(pg_get_function_result(p.oid), '')
         || '|lang=' || l.lanname || '|secdef=' || p.prosecdef || '|volatile=' || p.provolatile::text || '|strict=' || p.proisstrict
         || '|config=' || coalesce(array_to_string(p.proconfig, ','), '') || '|body_md5=' || md5(p.prosrc)
  from fn join pg_proc p on p.oid = fn.oid join pg_language l on l.oid = p.prolang
  union all
  select 'function_grant|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
         || coalesce((select string_agg(r.name || '=' || a.privilege_type, ',' order by r.name) from aclexplode(fn.proacl) a join rolename r on r.oid = a.grantee), 'default')
  from fn join pg_proc p on p.oid = fn.oid
  union all
  select 'enum|' || t.typname || '|' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
  from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and t.oid not in (select objid from ext) group by t.typname
  union all
  select 'domain|' || t.typname || '|' || format_type(t.typbasetype, t.typtypmod) || '|notnull=' || t.typnotnull
  from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'd'
  union all
  select 'default_acl|' || coalesce(r.name, '?') || '|' || d.defaclobjtype::text || '|' || coalesce((select string_agg(rr.name || '=' || a.privilege_type, ',' order by rr.name, a.privilege_type) from aclexplode(d.defaclacl) a join rolename rr on rr.oid = a.grantee), '')
  from pg_default_acl d left join rolename r on r.oid = d.defaclrole left join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public'
  union all select 'extension|' || e.extname || '|schema=' || n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
) lines order by line;`;

// ---------- commands ----------
function migrationsCheck(target) {
  const rows = readOnlySql(target, MIGRATIONS_SQL).map((l) => l.split("|"));
  const applied = rows.map((r) => r[0]);
  const baseFiles = spawnSync("git", ["ls-tree", "--name-only", `${PRODUCTION_BASE}`, "supabase/migrations/"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const baseVersions = baseFiles.map((f) => f.split("/").pop().split("_")[0]).sort();
  const repoNames = spawnSync("git", ["ls-files", "supabase/migrations/"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean).map((f) => f.split("/").pop().replace(/\.sql$/, "")).sort();
  const pending = repoNames.filter((n) => !applied.includes(n.split("_")[0]));
  const unknownRemote = applied.filter((v) => !repoNames.some((n) => n.startsWith(`${v}_`)));
  const sameAsBase = JSON.stringify(applied) === JSON.stringify(baseVersions);
  const pendingExact = JSON.stringify(pending) === JSON.stringify(EXPECTED_PENDING);
  return { appliedCount: applied.length, applied: rows.map(([v, n]) => (n ? `${v} ${n}` : v)), baseCount: baseVersions.length, sameAsBase, unknownRemote, pending, pendingExact, pass: sameAsBase && pendingExact && unknownRemote.length === 0 };
}

function counts(target) {
  return Object.fromEntries(readOnlySql(target, COUNTS_SQL).map((l) => l.split("|")).map(([t, c]) => [t, /^\d+$/.test(c) ? Number(c) : c]));
}

function catalog(target, file) {
  const lines = readOnlySql(target, CATALOG_SQL);
  writeFileSync(file, `${lines.join("\n")}\n`);
  return { file, lines: lines.length, sha256: sha256File(file) };
}

function drift(prodFile, refFile) {
  const a = new Set(readFileSync(prodFile, "utf8").split("\n").filter(Boolean));
  const b = new Set(readFileSync(refFile, "utf8").split("\n").filter(Boolean));
  return { onlyInTarget: [...a].filter((l) => !b.has(l)).sort(), onlyInReference: [...b].filter((l) => !a.has(l)).sort() };
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

if (command === "inspect") {
  const out = outsideRepo(opts.out ?? fail("--out <dir outside the repo> is required"));
  mkdirSync(out, { recursive: true });
  const target = resolveTarget(opts.target);
  const startedAt = nowUtc();
  const migrations = migrationsCheck(target);
  console.log(`R3 migrations on ${target.label}: ${migrations.appliedCount} applied (base ${PRODUCTION_BASE}: ${migrations.baseCount}), identical to base: ${migrations.sameAsBase}, unknown remote: ${migrations.unknownRemote.length}, pending exactly the 10 UX: ${migrations.pendingExact}`);
  const grants = readOnlySql(target, ATHLETES_GRANTS_SQL);
  console.log(`athletes grants / RLS / policies:\n  ${grants.join("\n  ")}`);
  const baseline = counts(target);
  console.log(`baseline counts: ${Object.keys(baseline).length} tables (see summary)`);
  const cat = catalog(target, join(out, "catalog-target.txt"));
  const schemaDump = pgDumpToFile(target, ["--schema-only", "--schema=public"], join(out, "schema-public.sql"));
  const summary = { target: target.label, startedAt, finishedAt: nowUtc(), migrations, athletesGrants: grants, baselineCounts: baseline, catalog: cat, schemaDump };
  writeJson(join(out, "inspect-summary.json"), summary);
  console.log(`schema dump: ${schemaDump.bytes} bytes sha256 ${schemaDump.sha256}; catalog ${cat.lines} lines sha256 ${cat.sha256}`);
  console.log(`summary: ${join(out, "inspect-summary.json")}`);
  if (!migrations.pass) fail("migration history is not exactly the expected state (50 applied = ba59239, exactly the 10 UX pending)");
} else if (command === "catalog") {
  const target = resolveTarget(opts.target);
  const file = outsideRepo(opts.out ?? fail("--out <file outside the repo> is required"));
  mkdirSync(dirname(file), { recursive: true });
  const cat = catalog(target, file);
  console.log(`catalog of ${target.label}: ${cat.lines} lines sha256 ${cat.sha256}`);
} else if (command === "drift") {
  const d = drift(opts.prod ?? fail("--prod <catalog>"), opts.ref ?? fail("--ref <catalog>"));
  const report = { onlyInTarget: d.onlyInTarget, onlyInReference: d.onlyInReference, material: d.onlyInTarget.length + d.onlyInReference.length };
  if (opts.out) writeJson(outsideRepo(opts.out), report);
  console.log(`drift: ${report.onlyInTarget.length} line(s) only in target, ${report.onlyInReference.length} only in reference`);
  for (const l of report.onlyInTarget) console.log(`  + ${l}`);
  for (const l of report.onlyInReference) console.log(`  - ${l}`);
  if (report.material > 0) process.exitCode = 2;
} else if (command === "backup") {
  const out = outsideRepo(opts.out ?? fail("--out <dir outside the repo> is required"));
  mkdirSync(out, { recursive: true });
  const target = resolveTarget(opts.target);
  const startedAt = nowUtc();
  const before = counts(target);
  // Scope: application schema + data (public), migration history (supabase_migrations), Auth identities
  // and Storage metadata as DATA only (their schemas belong to the platform services).
  const archives = {
    app: pgDumpToFile(target, ["--format=custom", "--schema=public", "--schema=supabase_migrations"], join(out, "app-public-and-migrations.dump")),
    // auth.schema_migrations is the Auth service's own version table: the target project's service maintains it.
    auth: pgDumpToFile(target, ["--format=custom", "--data-only", "--schema=auth", "--exclude-table=auth.schema_migrations"], join(out, "auth-data.dump")),
    storage: pgDumpToFile(target, ["--format=custom", "--data-only", "--schema=storage"], join(out, "storage-data.dump")),
  };
  const cat = catalog(target, join(out, "catalog-at-backup.txt"));
  const after = counts(target);
  const stable = JSON.stringify(before) === JSON.stringify(after);
  const summary = { target: target.label, startedAt, finishedAt: nowUtc(), format: "pg_dump custom (-Fc), PostgreSQL 17 client", archives, catalog: cat, countsBefore: before, countsAfter: after, countsStableDuringBackup: stable };
  writeJson(join(out, "backup-summary.json"), summary);
  writeFileSync(join(out, "SHA256SUMS"), Object.values(archives).map((a) => `${a.sha256}  ${a.file.split(/[\\/]/).pop()}`).join("\n") + "\n");
  for (const [k, a] of Object.entries(archives)) console.log(`${k}: ${a.bytes} bytes sha256 ${a.sha256}`);
  console.log(`counts stable during backup: ${stable}`);
  if (!stable) console.log("WARNING: counts changed during the backup window (live writes); compare restore counts with countsAfter / countsBefore.");
} else if (command === "restore-check") {
  const dir = resolve(opts.backup ?? fail("--backup <dir>"));
  const into = resolveTarget(opts.into ?? fail("--into local:<container>"));
  if (into.kind !== "local") fail("restore-check only restores into a LOCAL container");
  const summary = JSON.parse(readFileSync(join(dir, "backup-summary.json"), "utf8"));
  for (const a of Object.values(summary.archives)) {
    const file = join(dir, a.file.split(/[\\/]/).pop());
    if (sha256File(file) !== a.sha256) fail(`checksum mismatch for ${file}`);
  }
  const errors = {};
  const restore = (name, args) => {
    const file = join(dir, summary.archives[name].file.split(/[\\/]/).pop());
    const r = spawnSync("docker", dockerArgs(into, "pg_restore", args, { superuser: true }), { input: readFileSync(file), maxBuffer: 256 * 1024 * 1024 });
    const lines = String(r.stderr).split("\n").filter((l) => /error/i.test(l)).map((l) => l.replace(/\(([^)]*)\)=\(([^)]*)\)/g, "(…)=(…)").slice(0, 220));
    errors[name] = { exit: r.status, errorLines: lines.length, sample: lines.slice(0, 15) };
  };
  // LOCAL throwaway target only: drop the stack's own default privileges in public so that restored
  // objects get exactly the dumped ACLs (the dump re-applies production's ALTER DEFAULT PRIVILEGES).
  localSuperSql(into, ["postgres", "supabase_admin"].flatMap((r) => ["TABLES", "SEQUENCES", "FUNCTIONS"].map((o) => `alter default privileges for role ${r} in schema public revoke all on ${o} from anon, authenticated, service_role;`)).join("\n"));
  // Order: platform data first (athletes.user_id references auth.users), then the application.
  restore("auth", ["--data-only", "--disable-triggers"]);
  restore("storage", ["--data-only", "--disable-triggers"]);
  restore("app", []);
  const restoredCounts = counts(into);
  const reference = summary.countsAfter;
  const countMismatches = Object.keys(reference).filter((t) => reference[t] !== restoredCounts[t]).map((t) => `${t}: backup ${reference[t]} / restored ${restoredCounts[t] ?? "absent"}`);
  const restoredCatalog = join(dir, "catalog-restored.txt");
  catalog(into, restoredCatalog);
  const d = drift(restoredCatalog, join(dir, "catalog-at-backup.txt"));
  const orphanAthletes = readOnlySql(into, "select count(*) from public.athletes a where not exists (select 1 from auth.users u where u.id = a.user_id);")[0];
  const result = { restoredInto: into.label, at: nowUtc(), pgRestore: errors, countMismatches, catalogDrift: { onlyInRestored: d.onlyInTarget, onlyInBackup: d.onlyInReference }, athletesWithoutAuthUser: Number(orphanAthletes) };
  writeJson(join(dir, "restore-check.json"), result);
  console.log(JSON.stringify({ ...result, catalogDrift: { onlyInRestored: d.onlyInTarget.length, onlyInBackup: d.onlyInReference.length } }, null, 2));
} else {
  fail("usage: inspect | catalog | drift | backup | restore-check (see the header of this file)");
}
