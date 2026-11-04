/**
 * Minimal in-memory D1 stub for Vitest. Implements exactly the SQL shapes
 * src/index.ts issues: INSERT [OR IGNORE] ... VALUES (?, 'lit', ...) with
 * optional ON CONFLICT(cols) DO UPDATE SET col = excluded.col | ? | literal,
 * SELECT cols|*|COUNT(*) FROM t [WHERE col = ?|'lit' [AND ...]]
 * [ORDER BY col [DESC]] [LIMIT ?|n], UPDATE ... SET col = ? WHERE ...,
 * DELETE FROM t WHERE col = ? [AND ...]. Not a SQL engine — a test double
 * faithful to the statements the app actually runs.
 */
type Row = Record<string, unknown>;

const PRIMARY_KEYS: Record<string, string[]> = {
  settings: ["owner", "key"],
  notification_prefs: ["owner", "type"],
  strava_tokens: ["owner"],
  rr_series: ["measurement_id"],
  users: ["email"],
};

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let inStr = false;
  for (const ch of s) {
    if (ch === "'") inStr = !inStr;
    if (!inStr) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function literalValue(tok: string, binds: unknown[], bi: { i: number }): unknown {
  const t = tok.trim();
  if (t === "?") return binds[bi.i++];
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^datetime\('now'\)$/i.test(t)) return new Date().toISOString();
  if (/^excluded\.(\w+)$/.test(t)) throw new Error("excluded.* only valid in ON CONFLICT SET");
  return t;
}

export class StubD1 {
  tables = new Map<string, Row[]>();
  private seq = new Map<string, number>();

  table(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }
  nextId(name: string): number {
    const n = (this.seq.get(name) ?? 0) + 1;
    this.seq.set(name, n);
    return n;
  }
  prepare(sql: string): StubStmt {
    return new StubStmt(this, sql);
  }
  async batch(stmts: StubStmt[]): Promise<Array<{ meta: { changes: number; last_row_id: number }; success: boolean }>> {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }
}

class StubStmt {
  private binds: unknown[] = [];
  constructor(
    private db: StubD1,
    private sql: string,
  ) {}
  bind(...args: unknown[]): StubStmt {
    // Real D1 bind() returns a NEW statement (the app prepares once and
    // binds many times for batch inserts) — mirror that.
    const s = new StubStmt(this.db, this.sql);
    s.binds = args;
    return s;
  }

  private wherePredicate(where: string | undefined, binds: unknown[], row: Row, bi: { i: number }): boolean {
    if (!where) return true;
    const conds = where.split(/\s+AND\s+/i);
    for (const cond of conds) {
      const m = /^(\w+)\s*=\s*(.+)$/.exec(cond.trim());
      if (!m) throw new Error(`stub: unsupported WHERE condition: ${cond}`);
      const val = literalValue(m[2], binds, bi);
      if (row[m[1]] !== val) return false;
    }
    return true;
  }

  async all<T = Row>(): Promise<{ results: T[] }> {
    return { results: this.select() as T[] };
  }
  async first<T = Row>(): Promise<T | null> {
    const rows = this.select();
    return (rows[0] as T) ?? null;
  }

  private select(): Row[] {
    const sql = this.sql.trim().replace(/\s+/g, " ");
    const m = /^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (\w+)( DESC| ASC)?)?(?: LIMIT (\?|\d+))?$/i.exec(sql);
    if (!m) throw new Error(`stub: unsupported SELECT: ${sql}`);
    const [, colsRaw, table, where, orderCol, orderDir, limitRaw] = m;
    // Bind placeholders are consumed per-row for WHERE (fresh counter each
    // row); a LIMIT ? placeholder sits after the WHERE placeholders.
    let rows = this.db.table(table).filter((r) => this.wherePredicate(where, this.binds, r, { i: 0 }));
    if (colsRaw.trim().startsWith("COUNT(*)")) {
      return [{ n: rows.length }];
    }
    if (orderCol) {
      const dir = orderDir && orderDir.trim().toUpperCase() === "DESC" ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const av = a[orderCol];
        const bv = b[orderCol];
        return (av === bv ? 0 : av! < bv! ? -1 : 1) * dir;
      });
    }
    if (limitRaw !== undefined) {
      const whereBinds = where ? (where.match(/\?/g) ?? []).length : 0;
      const lim = limitRaw === "?" ? Number(this.binds[whereBinds]) : Number(limitRaw);
      rows = rows.slice(0, lim);
    }
    const cols = colsRaw.trim();
    if (cols === "*") return rows.map((r) => ({ ...r }));
    const wanted = splitTopLevel(cols).map((c) => c.trim());
    return rows.map((r) => {
      const out: Row = {};
      for (const c of wanted) out[c] = r[c];
      return out;
    });
  }

  async run(): Promise<{ meta: { changes: number; last_row_id: number }; success: boolean }> {
    const sql = this.sql.trim().replace(/\s+/g, " ");
    const bi = { i: 0 };

    const ins = /^INSERT( OR IGNORE)? INTO (\w+) \(([^)]+)\) VALUES \((.+?)\)(?: ON CONFLICT\(([^)]+)\) DO UPDATE SET (.+))?$/i.exec(sql);
    if (ins) {
      const [, orIgnore, table, colsRaw, valsRaw, conflictCols, setRaw] = ins;
      const cols = splitTopLevel(colsRaw).map((c) => c.trim());
      const vals = splitTopLevel(valsRaw).map((v) => literalValue(v, this.binds, bi));
      const row: Row = {};
      cols.forEach((c, idx) => (row[c] = vals[idx]));
      const rows = this.db.table(table);
      const id = this.db.nextId(table);
      if (row.id === undefined) row.id = id;
      const conflictKeys = conflictCols
        ? splitTopLevel(conflictCols).map((c) => c.trim())
        : (PRIMARY_KEYS[table] ?? []);
      const findConflict = (keys: string[]): Row | undefined =>
        keys.length ? rows.find((r) => keys.every((k) => r[k] === row[k])) : undefined;
      let existing = conflictKeys.length ? findConflict(conflictKeys) : undefined;
      // health_samples partial unique index (owner, source, external_id) WHERE external_id IS NOT NULL
      if (!existing && table === "health_samples" && row.external_id !== null && row.external_id !== undefined) {
        existing = findConflict(["owner", "source", "external_id"]);
      }
      if (existing) {
        if (orIgnore) return { meta: { changes: 0, last_row_id: 0 }, success: true };
        if (setRaw) {
          for (const assign of splitTopLevel(setRaw)) {
            const am = /^(\w+)\s*=\s*(.+)$/.exec(assign.trim());
            if (!am) continue;
            const rhs = am[2].trim();
            const ex = /^excluded\.(\w+)$/.exec(rhs);
            existing[am[1]] = ex ? row[ex[1]] : literalValue(rhs, this.binds, bi);
          }
          return { meta: { changes: 1, last_row_id: Number(existing.id ?? 0) }, success: true };
        }
        throw new Error(`stub: UNIQUE constraint failed: ${table}`);
      }
      rows.push(row);
      return { meta: { changes: 1, last_row_id: id }, success: true };
    }

    const upd = /^UPDATE (\w+) SET (.+?) WHERE (.+)$/i.exec(sql);
    if (upd) {
      const [, table, setRaw, where] = upd;
      let changes = 0;
      for (const row of this.db.table(table)) {
        // SET binds come before WHERE binds in statement order.
        const setBi = { i: 0 };
        const assigns = splitTopLevel(setRaw).map((a) => {
          const am = /^(\w+)\s*=\s*(.+)$/.exec(a.trim());
          if (!am) throw new Error(`stub: bad SET ${a}`);
          return { col: am[1], val: literalValue(am[2], this.binds, setBi) };
        });
        const whereBi = { i: setBi.i };
        if (this.wherePredicate(where, this.binds, row, whereBi)) {
          for (const a of assigns) row[a.col] = a.val;
          changes++;
        }
      }
      return { meta: { changes, last_row_id: 0 }, success: true };
    }

    const del = /^DELETE FROM (\w+)(?: WHERE (.+))?$/i.exec(sql);
    if (del) {
      const [, table, where] = del;
      const rows = this.db.table(table);
      const kept = rows.filter((r) => !this.wherePredicate(where, this.binds, r, { i: 0 }));
      this.db.tables.set(table, kept);
      return { meta: { changes: rows.length - kept.length, last_row_id: 0 }, success: true };
    }

    throw new Error(`stub: unsupported statement: ${sql}`);
  }
}
