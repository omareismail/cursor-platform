// SQL statement classification for guard-mcp.mjs (and the psql rule in guard-bash.mjs).
// No dependencies. Pure functions - nothing here reads a file or exits.
//
// WHY A TOKENIZER AND NOT A REGEX, AND NOT A PARSER
//
// The first check was "strip leading comments, read the first word, compare it
// to sqlAllow, then split on every semicolon". It let through
//
//   WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d   -- WITH is allowed
//   EXPLAIN ANALYZE DELETE FROM users                            -- EXPLAIN is allowed, ANALYZE executes
//   SELECT 1; -- note\nDELETE FROM users                         -- tail starts with "-"
//   SELECT ';'; DELETE FROM users                                -- split inside a literal
//   SELECT pg_sleep(10), lo_import('/etc/passwd')                -- SELECT is a verb
//
// Every one of those is decided by knowing where comments and string literals
// begin and end, and which words are keywords. That is a tokenizer: ~80 lines,
// no grammar. A full SQL parser would add a dependency the platform forbids and
// would still not be the boundary - the database role is. This is the lock that
// runs before the query leaves, and it does not have to be perfect to be worth
// having; it has to fail closed on everything it does not understand.

/** Statement-level keywords that change data, schema, or session state. */
export const DML_KEYWORDS = new Set([
  "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "DROP", "ALTER", "CREATE",
  "GRANT", "REVOKE", "COPY", "CALL", "DO", "LOCK", "VACUUM", "REINDEX", "CLUSTER",
  "REFRESH", "RESET", "DISCARD", "NOTIFY", "PREPARE", "DEALLOCATE", "COMMIT",
  "ROLLBACK", "SAVEPOINT", "IMPORT", "SECURITY",
]);

/**
 * Functions a read-only session has no business calling. Side effects, file
 * system reach, session control, or a way to tie up a connection. Schema
 * qualification is ignored: `pg_catalog.pg_sleep` is `pg_sleep`.
 */
export const DEFAULT_DENY_FUNCTIONS = [
  "pg_sleep", "pg_sleep_for", "pg_sleep_until",
  "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_ls_logdir", "pg_ls_waldir", "pg_stat_file",
  "pg_file_write", "pg_file_unlink", "pg_file_rename",
  "lo_import", "lo_export", "lo_unlink", "lo_from_bytea", "lo_put", "lo_create", "lo_creat",
  "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile",
  "pg_switch_wal", "pg_create_restore_point", "pg_promote",
  "set_config", "nextval", "setval",
  "dblink", "dblink_exec", "dblink_connect", "dblink_connect_u", "dblink_send_query",
  "pg_advisory_lock", "pg_advisory_xact_lock", "pg_try_advisory_lock", "pg_try_advisory_xact_lock",
  "pg_advisory_lock_shared", "pg_advisory_xact_lock_shared",
  "pg_notify", "pg_logical_emit_message",
];

const EXPLAIN_OPTIONS = new Set(["ANALYZE", "ANALYSE", "VERBOSE", "COSTS", "SETTINGS", "GENERIC_PLAN",
                                 "BUFFERS", "WAL", "TIMING", "SUMMARY", "FORMAT", "MEMORY", "SERIALIZE",
                                 "TRUE", "FALSE", "ON", "OFF", "TEXT", "JSON", "XML", "YAML", "NONE", "BINARY"]);

const isIdentStart = (c) => /[A-Za-z_\u0080-\uffff]/.test(c);
const isIdentChar = (c) => /[A-Za-z0-9_$\u0080-\uffff]/.test(c);

/**
 * Tokens: { t: "word" | "quoted" | "string" | "number" | "param" | "punct", v }.
 * Comments vanish. Never throws: an unterminated literal or comment swallows
 * the rest of the input, which is the fail-closed direction - the text after
 * it can no longer hide a second statement.
 */
export function tokenize(sql) {
  const s = String(sql ?? "");
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && d === "-") { const e = s.indexOf("\n", i); i = e < 0 ? n : e + 1; continue; }
    if (c === "/" && d === "*") {                      // nested, as Postgres allows
      let depth = 1; i += 2;
      while (i < n && depth) {
        if (s[i] === "/" && s[i + 1] === "*") { depth++; i += 2; }
        else if (s[i] === "*" && s[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    if (c === "'") {
      // E'...' honours backslash escapes; a plain literal only doubles the quote.
      const prev = out[out.length - 1];
      const escapes = prev && prev.t === "word" && /^[eE]$/.test(prev.v) && prev.end === i;
      if (escapes) out.pop();
      let j = i + 1, v = "";
      while (j < n) {
        if (escapes && s[j] === "\\") { v += s[j + 1] ?? ""; j += 2; continue; }
        if (s[j] === "'") { if (s[j + 1] === "'") { v += "'"; j += 2; continue; } break; }
        v += s[j++];
      }
      out.push({ t: "string", v }); i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1, v = "";
      while (j < n) {
        if (s[j] === '"') { if (s[j + 1] === '"') { v += '"'; j += 2; continue; } break; }
        v += s[j++];
      }
      out.push({ t: "quoted", v }); i = j + 1; continue;
    }
    if (c === "$") {
      const m = s.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {                                           // $tag$ ... $tag$
        const tag = m[0];
        const e = s.indexOf(tag, i + tag.length);
        out.push({ t: "string", v: e < 0 ? s.slice(i + tag.length) : s.slice(i + tag.length, e) });
        i = e < 0 ? n : e + tag.length; continue;
      }
      const p = s.slice(i).match(/^\$\d+/);
      if (p) { out.push({ t: "param", v: p[0] }); i += p[0].length; continue; }
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentChar(s[j])) j++;
      out.push({ t: "word", v: s.slice(i, j), end: j }); i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(d ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9.eE+\-]/.test(s[j]) && !(/[+\-]/.test(s[j]) && !/[eE]/.test(s[j - 1]))) j++;
      out.push({ t: "number", v: s.slice(i, j) }); i = j; continue;
    }
    out.push({ t: "punct", v: c }); i++;
  }
  return out;
}

/** Split on top-level semicolons; empty segments (a trailing `;`) do not count. */
export function splitStatements(tokens) {
  const stmts = [];
  let cur = [], depth = 0;
  for (const tk of tokens) {
    if (tk.t === "punct" && tk.v === "(") depth++;
    if (tk.t === "punct" && tk.v === ")") depth = Math.max(0, depth - 1);
    if (tk.t === "punct" && tk.v === ";" && depth === 0) { if (cur.length) stmts.push(cur); cur = []; continue; }
    cur.push(tk);
  }
  if (cur.length) stmts.push(cur);
  return stmts;
}

/**
 * What one statement is, as facts rather than a verdict:
 *   verb            first keyword, upper-cased ("" when the statement is empty)
 *   keywords        every unquoted word, upper-cased
 *   functions       every unquoted word followed by "(", lower-cased
 *   dml             a data/schema/session-changing keyword appears ANYWHERE
 *   explainAnalyze  EXPLAIN with ANALYZE/ANALYSE among its options - it EXECUTES
 *   explained       for EXPLAIN, the verb of the statement being explained
 *   locking         FOR UPDATE | FOR NO KEY UPDATE | FOR SHARE | FOR KEY SHARE
 *   selectInto      SELECT ... INTO <table>, which creates a table
 */
export function classifyStatement(tokens) {
  const words = tokens.filter((t) => t.t === "word");
  const verb = (words[0]?.v || "").toUpperCase();
  const keywords = new Set(words.map((w) => w.v.toUpperCase()));
  const functions = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].t === "word" && tokens[i + 1].t === "punct" && tokens[i + 1].v === "(") functions.add(tokens[i].v.toLowerCase());
  }
  const dml = [...keywords].filter((k) => DML_KEYWORDS.has(k));

  let explainAnalyze = false, explained = null;
  if (verb === "EXPLAIN") {
    let i = 1;
    if (tokens[i]?.t === "punct" && tokens[i].v === "(") {
      let depth = 0;
      for (; i < tokens.length; i++) {
        const tk = tokens[i];
        if (tk.t === "punct" && tk.v === "(") depth++;
        else if (tk.t === "punct" && tk.v === ")") { if (--depth === 0) { i++; break; } }
        else if (tk.t === "word" && /^ANALY[SZ]E$/i.test(tk.v)) explainAnalyze = true;
      }
    } else {
      while (tokens[i]?.t === "word" && EXPLAIN_OPTIONS.has(tokens[i].v.toUpperCase())) {
        if (/^ANALY[SZ]E$/i.test(tokens[i].v)) explainAnalyze = true;
        i++;
      }
    }
    explained = (tokens[i]?.t === "word" ? tokens[i].v : "").toUpperCase() || null;
  }

  let locking = false, selectInto = false;
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i].v.toUpperCase(), b = words[i + 1].v.toUpperCase();
    if (a === "FOR" && (b === "UPDATE" || b === "SHARE" || b === "NO" || b === "KEY")) locking = true;
  }
  if ((verb === "SELECT" || verb === "WITH" || verb === "EXPLAIN") && keywords.has("INTO") && !keywords.has("INSERT")) selectInto = true;

  return { verb, keywords, functions, dml, explainAnalyze, explained, locking, selectInto };
}

/**
 * The verdict a read-only policy gives one piece of SQL text.
 *
 *   rule.sqlAllow          leading keywords permitted (e.g. SELECT, WITH, EXPLAIN, SHOW)
 *   rule.sqlDenyFunctions  extra function names to refuse, merged with the defaults
 *
 * Returns { ok: true } or { ok: false, reason, detail }. Refuses on anything it
 * cannot classify as a single read - unknown is not allowed.
 */
export function judge(sql, rule = {}) {
  const text = String(sql ?? "");
  if (!text.trim()) return { ok: true, empty: true };
  const allow = new Set((rule.sqlAllow || []).map((a) => String(a).toUpperCase()));
  const denyFns = new Set([...DEFAULT_DENY_FUNCTIONS, ...(rule.sqlDenyFunctions || [])].map((f) => String(f).toLowerCase()));

  const stmts = splitStatements(tokenize(text));
  if (!stmts.length) return { ok: true, empty: true };            // comments only
  if (stmts.length > 1) {
    const second = stmts[1].map((t) => t.v).join(" ").slice(0, 80);
    return { ok: false, reason: "more than one statement", detail: `second statement begins: ${second}` };
  }
  const c = classifyStatement(stmts[0]);
  if (!c.verb) return { ok: false, reason: "no leading keyword", detail: "the statement does not start with a word" };
  if (!allow.has(c.verb)) return { ok: false, reason: `"${c.verb}" is not an allowed statement`, detail: `allowed: ${[...allow].join(", ")}` };
  if (c.explainAnalyze) return { ok: false, reason: "EXPLAIN ANALYZE executes the statement it explains", detail: "use EXPLAIN without ANALYZE" };
  if (c.verb === "EXPLAIN" && c.explained && !allow.has(c.explained)) {
    return { ok: false, reason: `EXPLAIN of a "${c.explained}" statement`, detail: "explaining a write plans it against live data; explain reads only" };
  }
  if (c.dml.length) {
    return { ok: false, reason: `data-modifying keyword ${c.dml.join(", ")} inside a ${c.verb} statement`, detail: "a CTE, subquery or EXPLAIN target can carry a write - the leading keyword says nothing about what follows" };
  }
  if (c.selectInto) return { ok: false, reason: "SELECT ... INTO creates a table", detail: "read-only means no new objects either" };
  if (c.locking) return { ok: false, reason: "row locking (FOR UPDATE / FOR SHARE)", detail: "a read that takes locks blocks writers; not a read-only operation" };
  const bad = [...c.functions].filter((f) => denyFns.has(f));
  if (bad.length) return { ok: false, reason: `function ${bad.join(", ")} is denied for a read-only session`, detail: "side effects, file access, session control or a way to hold the connection" };
  return { ok: true, verb: c.verb };
}

/**
 * Every string that could be SQL inside a tool's arguments - top-level values,
 * nested objects, arrays. The old check read five named fields; a server whose
 * parameter is called `command`, or that takes an array of statements, went
 * uninspected. Depth-bounded so a hostile payload cannot recurse forever.
 */
export function stringsIn(input, depth = 0, out = []) {
  if (depth > 6 || out.length > 200) return out;
  if (typeof input === "string") { out.push(input); return out; }
  if (Array.isArray(input)) { for (const v of input) stringsIn(v, depth + 1, out); return out; }
  if (input && typeof input === "object") { for (const v of Object.values(input)) stringsIn(v, depth + 1, out); return out; }
  return out;
}

/** Does this text look like SQL at all? Keeps prose arguments (a search term, a path) out of the classifier. */
export function looksLikeSql(text) {
  const stmts = splitStatements(tokenize(text));
  if (!stmts.length) return false;
  const first = stmts[0].find((t) => t.t === "word");
  if (!first) return false;
  const v = first.v.toUpperCase();
  return SQL_VERBS.has(v) || (stmts.length > 1 && stmts.some((s) => SQL_VERBS.has((s.find((t) => t.t === "word")?.v || "").toUpperCase())));
}
const SQL_VERBS = new Set([...DML_KEYWORDS, "SELECT", "WITH", "EXPLAIN", "SHOW", "TABLE", "VALUES", "SET", "BEGIN",
                          "START", "END", "ABORT", "ANALYZE", "ANALYSE", "EXECUTE", "DECLARE", "FETCH", "MOVE", "CLOSE", "LISTEN", "UNLISTEN", "LOAD", "CHECKPOINT"]);
