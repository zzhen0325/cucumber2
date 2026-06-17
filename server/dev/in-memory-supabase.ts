import { randomUUID } from "node:crypto";

/**
 * DEV-ONLY in-memory stand-in for the Supabase client.
 *
 * Activated *only* when `CUCUMBER_DEV_INMEMORY_DB=1`. It implements the narrow,
 * chainable query surface this codebase actually uses (from/select/insert/update/
 * upsert/delete + eq/is/gt/order/limit/single/maybeSingle/returns) so the real
 * server, real Agent runtime and real frontend can run end-to-end without a
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
    if (row.node_count == null) row.node_count = 0;
    if (row.edge_count == null) row.edge_count = 0;
    if (row.image_count == null) row.image_count = 0;
    if (row.snapshot_bytes == null) row.snapshot_bytes = 0;
    if (row.selected_node_id === undefined) row.selected_node_id = null;
    if (row.last_run_id === undefined) row.last_run_id = null;
    if (row.user_id === undefined) row.user_id = null;
  }
  if (table === "app_sessions" && row.last_seen_at === undefined) {
    row.last_seen_at = null;
  }
  if (table === "agent_artifacts") {
    if (row.run_node_id === undefined) row.run_node_id = null;
    if (row.uri === undefined) row.uri = null;
    if (row.title === undefined) row.title = null;
    if (row.metadata == null) row.metadata = {};
    if (row.content_ref === undefined) row.content_ref = null;
    if (row.tool_call_id === undefined) row.tool_call_id = null;
    if (row.source_node_id === undefined) row.source_node_id = null;
    if (row.bucket_id === undefined) row.bucket_id = null;
    if (row.storage_path === undefined) row.storage_path = null;
    if (row.mime_type === undefined) row.mime_type = null;
    if (row.size_bytes === undefined) row.size_bytes = null;
    if (row.origin == null) row.origin = "user_upload";
    if (row.created_by === undefined) row.created_by = null;
    if (row.summary === undefined) row.summary = null;
    if (row.preview_text === undefined) row.preview_text = null;
    if (row.preview_kind === undefined) row.preview_kind = null;
    if (row.version == null) row.version = 0;
    if (row.deleted_at === undefined) row.deleted_at = null;
    if (row.updated_at == null) row.updated_at = nowIso();
  }
  if (table === "agent_canvas_nodes") {
    if (row.version == null) row.version = 0;
    if (row.deleted_at === undefined) row.deleted_at = null;
    if (row.updated_at == null) row.updated_at = nowIso();
  }
  if (table === "agent_canvas_edges") {
    if (row.version == null) row.version = 0;
    if (row.deleted_at === undefined) row.deleted_at = null;
    if (row.updated_at == null) row.updated_at = nowIso();
  }
  if (table === "agent_artifact_contents") {
    if (row.size_bytes == null) row.size_bytes = 0;
    if (row.version == null) row.version = 0;
    if (row.deleted_at === undefined) row.deleted_at = null;
    if (row.updated_at == null) row.updated_at = nowIso();
  }
  if (table === "agent_knowledge_chunks") {
    if (row.source_node_id === undefined) row.source_node_id = null;
    if (row.keyword_index == null) row.keyword_index = [];
    if (row.embedding === undefined) row.embedding = null;
    if (row.metadata == null) row.metadata = {};
    if (row.updated_at == null) row.updated_at = nowIso();
  }
  if (table === "agent_skill_definitions") {
    if (row.agent_scope === undefined) row.agent_scope = "general";
    if (row.purpose === undefined) row.purpose = "general";
    if (row.tags == null) row.tags = [];
    if (row.triggers == null) row.triggers = { canvasKinds: [], keywords: [] };
    if (row.bindings == null) row.bindings = { agents: [], scopes: [], tools: [] };
    if (row.scripts == null) row.scripts = [];
    if (row.package_bucket === undefined) row.package_bucket = null;
    if (row.package_path === undefined) row.package_path = null;
    if (row.package_sha256 === undefined) row.package_sha256 = null;
    if (row.package_size_bytes === undefined) row.package_size_bytes = null;
    if (row.enabled === undefined) row.enabled = true;
    if (row.is_default === undefined) row.is_default = false;
    if (row.source_type === undefined) row.source_type = "manual";
    if (row.source_manifest == null) row.source_manifest = {};
    if (row.frontmatter == null) row.frontmatter = {};
    if (row.created_by === undefined) row.created_by = null;
    if (row.deleted_at === undefined) row.deleted_at = null;
    if (row.updated_at == null) row.updated_at = nowIso();
  }
  return row;
}

class InMemoryDb {
  tables: Record<string, Row[]> = {};
  storage = new InMemoryStorage();

  table(name: string) {
    return (this.tables[name] ??= []);
  }

  from(name: string) {
    return new InMemoryQuery(this, name);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    if (name === "apply_canvas_patch") {
      return this.applyCanvasPatch(args);
    }
    if (name === "upsert_text_artifact_content") {
      return this.upsertTextArtifactContent(args);
    }
    return { data: null, error: new Error(`Unsupported RPC ${name}`) };
  }

  private async applyCanvasPatch(args: Record<string, unknown>) {
    const projectId = args.p_project_id;
    const userId = args.p_user_id;
    const projects = this.table("agent_projects");
    const project = projects.find(
      (row) =>
        row.id === projectId &&
        row.user_id === userId &&
        row.deleted_at == null
    );
    if (!project) {
      return { data: null, error: new Error("project_not_found") };
    }
    const expectedVersion = args.p_expected_version;
    if (
      typeof expectedVersion === "number" &&
      project.version !== expectedVersion
    ) {
      return { data: null, error: new Error("version_conflict") };
    }

    const now = nowIso();
    for (const row of (args.p_node_upserts as Row[] | undefined) ?? []) {
      upsertComposite(this.table("agent_canvas_nodes"), row, [
        "project_id",
        "node_id",
      ]);
    }
    for (const nodeId of (args.p_node_deletes as string[] | undefined) ?? []) {
      const row = this.table("agent_canvas_nodes").find(
        (candidate) =>
          candidate.project_id === projectId && candidate.node_id === nodeId
      );
      if (row) {
        row.deleted_at = now;
        row.updated_at = now;
      }
    }
    for (const row of (args.p_edge_upserts as Row[] | undefined) ?? []) {
      upsertComposite(this.table("agent_canvas_edges"), row, [
        "project_id",
        "edge_id",
      ]);
    }
    for (const edgeId of (args.p_edge_deletes as string[] | undefined) ?? []) {
      const row = this.table("agent_canvas_edges").find(
        (candidate) =>
          candidate.project_id === projectId && candidate.edge_id === edgeId
      );
      if (row) {
        row.deleted_at = now;
        row.updated_at = now;
      }
    }

    const nodeRows = this.table("agent_canvas_nodes").filter(
      (row) => row.project_id === projectId && row.deleted_at == null
    );
    const edgeRows = this.table("agent_canvas_edges").filter(
      (row) => row.project_id === projectId && row.deleted_at == null
    );
    project.version = Number(project.version ?? 0) + 1;
    project.selected_node_id = args.p_selected_node_id ?? null;
    project.last_run_id = args.p_last_run_id ?? null;
    project.node_count = nodeRows.length;
    project.edge_count = edgeRows.length;
    project.image_count = nodeRows.filter((row) => row.kind === "imageResult").length;
    project.snapshot_bytes = 0;
    project.updated_at = now;

    return {
      data: {
        id: project.id,
        title: project.title,
        selectedNodeId: project.selected_node_id,
        lastRunId: project.last_run_id,
        version: project.version,
        nodeCount: project.node_count,
        edgeCount: project.edge_count,
        imageCount: project.image_count,
        snapshotBytes: project.snapshot_bytes,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      },
      error: null,
    };
  }

  private async upsertTextArtifactContent(args: Record<string, unknown>) {
    const project = this.table("agent_projects").find(
      (row) =>
        row.id === args.p_project_id &&
        row.user_id === args.p_user_id &&
        row.deleted_at == null
    );
    if (!project) {
      return { data: null, error: new Error("project_not_found") };
    }

    const artifactId = String(args.p_artifact_id);
    const artifacts = this.table("agent_artifacts");
    const existing = artifacts.find(
      (row) => row.id === artifactId && row.deleted_at == null
    );
    if (
      existing &&
      typeof args.p_expected_version === "number" &&
      existing.version !== args.p_expected_version
    ) {
      return { data: null, error: new Error("artifact_version_conflict") };
    }
    const version = existing ? Number(existing.version ?? 0) + 1 : 0;
    const now = nowIso();
    const sizeBytes = Buffer.byteLength(String(args.p_content_text ?? "")) +
      Buffer.byteLength(JSON.stringify(args.p_content_json ?? ""));

    const artifact = upsertComposite(artifacts, {
      id: artifactId,
      project_id: args.p_project_id,
      run_node_id: null,
      type: args.p_type ?? "doc",
      uri: null,
      title: args.p_title ?? null,
      metadata: args.p_metadata ?? {},
      content_ref: null,
      mime_type: args.p_mime_type,
      size_bytes: sizeBytes,
      origin: "user_upload",
      created_by: args.p_user_id,
      summary: args.p_summary ?? null,
      preview_text: args.p_preview_text ?? null,
      preview_kind: args.p_preview_kind ?? null,
      version,
      deleted_at: null,
      updated_at: now,
    }, ["id"]);

    upsertComposite(this.table("agent_artifact_contents"), {
      project_id: args.p_project_id,
      artifact_id: artifactId,
      content_format: args.p_content_format,
      mime_type: args.p_mime_type,
      content_text: args.p_content_text ?? null,
      content_json: args.p_content_json ?? null,
      plain_text: args.p_plain_text ?? null,
      digest: null,
      size_bytes: sizeBytes,
      version,
      deleted_at: null,
      updated_at: now,
    }, ["project_id", "artifact_id"]);

    return {
      data: {
        id: artifactId,
        type: artifact.type,
        title: artifact.title,
        summary: artifact.summary,
        preview: artifact.preview_text,
        previewKind: artifact.preview_kind,
        mimeType: artifact.mime_type,
        sizeBytes: artifact.size_bytes,
        version,
        updatedAt: now,
      },
      error: null,
    };
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
        if (this.name === "agent_skill_definitions") {
          r.updated_at = nowIso();
        }
        if (this.name === "agent_knowledge_chunks") {
          r.updated_at = nowIso();
        }
      }
      return this.wantRows ? this.finalizeRows(target) : { data: null, error: null };
    }

    if (this.op === "upsert") {
      const arr = Array.isArray(this.values) ? this.values : [this.values as Row];
      const touched: Row[] = [];
      for (const v of arr) {
        const existing = v.id != null ? rows.find((r) => r.id === v.id) : undefined;
        if (existing) {
          Object.assign(existing, v);
          if (this.name === "agent_knowledge_chunks") {
            existing.updated_at = nowIso();
          }
          touched.push(existing);
        } else {
          const row = withDefaults(this.name, v);
          rows.push(row);
          touched.push(row);
        }
      }
      return this.wantRows ? this.finalizeRows(touched) : { data: null, error: null };
    }

    // delete
    this.db.tables[this.name] = rows.filter((r) => !this.matchesRow(r));
    return { data: null, error: null };
  }
}

function upsertComposite(rows: Row[], value: Row, keys: string[]) {
  const existing = rows.find((row) =>
    keys.every((key) => row[key] === value[key])
  );
  if (existing) {
    Object.assign(existing, value, {
      updated_at: nowIso(),
      version: value.version ?? Number(existing.version ?? 0) + 1,
    });
    return existing;
  }

  const row = { ...value };
  if (row.id == null && keys.includes("id")) {
    row.id = randomUUID();
  }
  if (row.created_at == null) {
    row.created_at = nowIso();
  }
  if (row.updated_at == null) {
    row.updated_at = nowIso();
  }
  if (row.version == null) {
    row.version = 0;
  }
  if (row.deleted_at === undefined) {
    row.deleted_at = null;
  }
  rows.push(row);
  return row;
}

type StoredObject = {
  body: unknown;
  contentType: string;
  size: number;
  updatedAt: string;
};

class InMemoryStorage {
  private objects = new Map<string, StoredObject>();

  from(bucket: string) {
    return new InMemoryStorageBucket(this.objects, bucket);
  }
}

class InMemoryStorageBucket {
  private objects: Map<string, StoredObject>;
  private bucket: string;

  constructor(objects: Map<string, StoredObject>, bucket: string) {
    this.objects = objects;
    this.bucket = bucket;
  }

  async createSignedUploadUrl(path: string) {
    return {
      data: {
        path,
        signedUrl: `http://127.0.0.1/__inmemory-storage/${this.bucket}/${encodeURIComponent(path)}`,
        token: `inmemory:${this.bucket}:${path}`,
      },
      error: null,
    };
  }

  async upload(
    path: string,
    body: unknown,
    options?: { contentType?: string; upsert?: boolean }
  ) {
    const key = this.key(path);
    if (!options?.upsert && this.objects.has(key)) {
      return { data: null, error: new Error("Asset Already Exists") };
    }

    this.objects.set(key, {
      body,
      contentType: options?.contentType ?? "application/octet-stream",
      size: getObjectSize(body),
      updatedAt: nowIso(),
    });

    return {
      data: { fullPath: `${this.bucket}/${path}`, path },
      error: null,
    };
  }

  async info(path: string) {
    const object = this.objects.get(this.key(path));
    if (!object) {
      return { data: null, error: new Error("Object not found") };
    }

    return {
      data: {
        metadata: {
          mimetype: object.contentType,
          size: object.size,
        },
        name: path.split("/").at(-1) ?? path,
        updated_at: object.updatedAt,
      },
      error: null,
    };
  }

  async createSignedUrl(path: string) {
    if (!this.objects.has(this.key(path))) {
      return { data: null, error: new Error("Object not found") };
    }

    return {
      data: {
        signedUrl: `http://127.0.0.1/__inmemory-storage/${this.bucket}/${encodeURIComponent(path)}?signed=1`,
      },
      error: null,
    };
  }

  async download(path: string) {
    const object = this.objects.get(this.key(path));
    if (!object) {
      return { data: null, error: new Error("Object not found") };
    }

    return {
      data: {
        async arrayBuffer() {
          if (object.body instanceof Uint8Array) {
            return object.body.buffer.slice(
              object.body.byteOffset,
              object.body.byteOffset + object.body.byteLength
            );
          }
          if (object.body instanceof ArrayBuffer) {
            return object.body;
          }
          if (typeof object.body === "string") {
            const buffer = Buffer.from(object.body);
            return buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength
            );
          }
          return new ArrayBuffer(0);
        },
      },
      error: null,
    };
  }

  private key(path: string) {
    return `${this.bucket}/${path}`;
  }
}

function getObjectSize(body: unknown) {
  if (body instanceof Uint8Array) {
    return body.byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (typeof body === "string") {
    return Buffer.byteLength(body);
  }
  return 0;
}

let cachedDb: InMemoryDb | null = null;

export function createInMemorySupabaseClient() {
  cachedDb ??= new InMemoryDb();
  const db = cachedDb;
  return {
    from(name: string) {
      return db.from(name);
    },
    rpc(name: string, args: Record<string, unknown>) {
      return db.rpc(name, args);
    },
    storage: db.storage,
  };
}
