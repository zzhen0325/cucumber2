import { randomUUID } from "node:crypto";

/**
 * DEV-ONLY in-memory stand-in for the Supabase client.
 *
 * Activated *only* when `CUCUMBER_DEV_INMEMORY_DB=1`. It implements the narrow,
 * chainable query surface this codebase actually uses (from/select/insert/update/
 * upsert/delete + eq/is/gt/order/limit/single/maybeSingle/returns) so the real
 * server, real agent-v2 runtime and real frontend can run end-to-end without a
 * provisioned cloud database.
 *
 * This is a local testing affordance, never wired into the production path: the
 * default code path still requires SUPABASE_URL + SUPABASE_SECRET_KEY.
 */

export function isInMemoryDbEnabled() {
  return process.env.CUCUMBER_DEV_INMEMORY_DB === "1";
}

type Row = Record<string, unknown>;
type Filter = { kind: "eq" | "is" | "gt"; col: string; val: unknown };

function nowIso() {
  return new Date().toISOString();
}

function withDefaults(table: string, value: Row): Row {
  const row: Row = { ...value };
  if (row.id == null) {
    row.id = randomUUID();
  }
  if (row.created_at == null) {
    row.created_at = nowIso();
  }
  if (table === "agent_projects") {
    if (row.updated_at == null) row.updated_at = nowIso();
    if (row.deleted_at === undefined) row.deleted_at = null;
    if (row.version == null) row.version = 0;
    if (row.nodes == null) row.nodes = [];
    if (row.edges == null) row.edges = [];
    if (row.selected_node_id === undefined) row.selected_node_id = null;
    if (row.last_run_id === undefined) row.last_run_id = null;
    if (row.user_id === undefined) row.user_id = null;
  }
  if (table === "app_sessions" && row.last_seen_at === undefined) {
    row.last_seen_at = null;
  }
  return row;
}

class InMemoryDb {
  tables: Record<string, Row[]> = {};

  table(name: string) {
    return (this.tables[name] ??= []);
  }

  from(name: string) {
    return new InMemoryQuery(this, name);
  }
}

class InMemoryQuery implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private db: InMemoryDb;
  private name: string;
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private opTouched = false;
  private values: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private wantRows = false;
  private singleMode: "single" | "maybe" | null = null;
  private headCount = false;

  constructor(db: InMemoryDb, name: string) {
    this.db = db;
    this.name = name;
  }

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    if (!this.opTouched) {
      this.op = "select";
      this.opTouched = true;
    } else {
      this.wantRows = true;
    }
    if (opts?.head) {
      this.headCount = true;
    }
    return this;
  }

  insert(values: Row | Row[]) {
    this.op = "insert";
    this.opTouched = true;
    this.values = values;
    return this;
  }

  update(values: Row) {
    this.op = "update";
    this.opTouched = true;
    this.values = values;
    return this;
  }

  upsert(values: Row | Row[]) {
    this.op = "upsert";
    this.opTouched = true;
    this.values = values;
    return this;
  }

  delete() {
    this.op = "delete";
    this.opTouched = true;
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ kind: "eq", col, val });
    return this;
  }

  is(col: string, val: unknown) {
    this.filters.push({ kind: "is", col, val });
    return this;
  }

  gt(col: string, val: unknown) {
    this.filters.push({ kind: "gt", col, val });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  returns<T>(): InMemoryQuery & { readonly __resultType?: T } {
    return this;
  }

  single() {
    this.singleMode = "single";
    return this.exec();
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this.exec();
  }

  then<TResult1 = { data: unknown; error: null; count?: number }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null; count?: number }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  private matchesRow(row: Row) {
    return this.filters.every((f) => {
      const cell = row[f.col];
      if (f.kind === "eq") return cell === f.val;
      if (f.kind === "is") return f.val === null ? cell == null : cell === f.val;
      if (f.kind === "gt") return (cell as never) > (f.val as never);
      return true;
    });
  }

  private finalizeRows(rows: Row[]) {
    if (this.headCount) {
      return { data: null, error: null as null, count: rows.length };
    }
    if (this.singleMode) {
      return { data: rows[0] ?? null, error: null as null };
    }
    return { data: rows, error: null as null };
  }

  private async exec(): Promise<{ data: unknown; error: null; count?: number }> {
    const rows = this.db.table(this.name);

    if (this.op === "select") {
      let result = rows.filter((r) => this.matchesRow(r));
      if (this.orderCol) {
        const col = this.orderCol;
        result = [...result].sort((a, b) => {
          const av = a[col] as never;
          const bv = b[col] as never;
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return this.orderAsc ? cmp : -cmp;
        });
      }
      if (this.limitN != null) {
        result = result.slice(0, this.limitN);
      }
      return this.finalizeRows(result);
    }

    if (this.op === "insert") {
      const arr = Array.isArray(this.values) ? this.values : [this.values as Row];
      const inserted = arr.map((v) => {
        const row = withDefaults(this.name, v);
        rows.push(row);
        return row;
      });
      return this.wantRows ? this.finalizeRows(inserted) : { data: null, error: null };
    }

    if (this.op === "update") {
      const target = rows.filter((r) => this.matchesRow(r));
      for (const r of target) {
        Object.assign(r, this.values as Row);
        if (this.name === "agent_projects") {
          r.updated_at = nowIso();
        }
      }
      return this.wantRows ? this.finalizeRows(target) : { data: null, error: null };
    }

    if (this.op === "upsert") {
      const arr = Array.isArray(this.values) ? this.values : [this.values as Row];
      for (const v of arr) {
        const existing = v.id != null ? rows.find((r) => r.id === v.id) : undefined;
        if (existing) {
          Object.assign(existing, v);
        } else {
          rows.push(withDefaults(this.name, v));
        }
      }
      return { data: null, error: null };
    }

    // delete
    this.db.tables[this.name] = rows.filter((r) => !this.matchesRow(r));
    return { data: null, error: null };
  }
}

let cachedDb: InMemoryDb | null = null;

export function createInMemorySupabaseClient() {
  cachedDb ??= new InMemoryDb();
  const db = cachedDb;
  return {
    from(name: string) {
      return db.from(name);
    },
  };
}
