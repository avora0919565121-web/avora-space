import type { ChangeEvent, FakeAvoraServer, Row, ServerReply } from "./fake-server";
import type { NetworkConditioner } from "./faults";

/**
 * 112-A · 2 — the Supabase client one person's app copy talks through. Same surface the app uses
 * (`rpc`, `from().select/eq/is/order/limit/…`, `channel().on().subscribe()`, `auth`, `storage`),
 * every call carried by that person's `NetworkConditioner`, so faults hit one person only.
 */

type Filter = (row: Row) => boolean;
type Order = { column: string; ascending: boolean };

class QueryBuilder implements PromiseLike<ServerReply> {
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private limitCount: number | null = null;
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private single: "one" | "maybe" | null = null;

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly tableName: string,
  ) {}

  select(_columns?: string): this {
    return this;
  }
  insert(values: Row | Row[]): this {
    this.mode = "insert";
    this.payload = values;
    return this;
  }
  upsert(values: Row | Row[]): this {
    this.mode = "upsert";
    this.payload = values;
    return this;
  }
  update(values: Row): this {
    this.mode = "update";
    this.payload = values;
    return this;
  }
  delete(): this {
    this.mode = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  gte(column: string, value: string | number): this {
    this.filters.push((row) => String(row[column]) >= String(value));
    return this;
  }
  gt(column: string, value: string | number): this {
    this.filters.push((row) => String(row[column]) > String(value));
    return this;
  }
  lte(column: string, value: string | number): this {
    this.filters.push((row) => String(row[column]) <= String(value));
    return this;
  }
  lt(column: string, value: string | number): this {
    this.filters.push((row) => String(row[column]) < String(value));
    return this;
  }
  /** Unhandled PostgREST filters are recorded and ignored (the server stays permissive). */
  or(_expression: string): this {
    this.client.server.unknown.add(`filter:or:${this.tableName}`);
    return this;
  }
  not(_column: string, _op: string, _value: unknown): this {
    this.client.server.unknown.add(`filter:not:${this.tableName}`);
    return this;
  }
  ilike(_column: string, _pattern: string): this {
    return this;
  }
  contains(_column: string, _value: unknown): this {
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  range(from: number, to: number): this {
    this.limitCount = to - from + 1;
    return this;
  }
  maybeSingle(): this {
    this.single = "maybe";
    return this;
  }
  singleRow(): this {
    this.single = "one";
    return this;
  }
  abortSignal(_signal: AbortSignal): this {
    return this;
  }

  private run(): ServerReply {
    const server = this.client.server;
    const userId = this.client.userId;
    const rows = server.table(this.tableName);
    server.calls.push({ userId, name: `${this.mode}:${this.tableName}`, args: null });
    if (this.mode === "insert" || this.mode === "upsert") {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      for (const value of values) rows.push({ ...value });
      return { data: values, error: null };
    }
    const visible = rows.filter((row) => server.canRead(userId, this.tableName, row) && this.filters.every((filter) => filter(row)));
    if (this.mode === "update") {
      for (const row of visible) Object.assign(row, this.payload);
      return { data: visible, error: null };
    }
    if (this.mode === "delete") {
      for (const row of visible) rows.splice(rows.indexOf(row), 1);
      return { data: visible, error: null };
    }
    const sorted = [...visible].sort((a, b) => {
      for (const order of this.orders) {
        const left = String(a[order.column] ?? "");
        const right = String(b[order.column] ?? "");
        if (left !== right) return (left < right ? -1 : 1) * (order.ascending ? 1 : -1);
      }
      return 0;
    });
    const limited = this.limitCount === null ? sorted : sorted.slice(0, this.limitCount);
    const copies = limited.map((row) => ({ ...row }));
    if (this.single === "maybe") return { data: copies[0] ?? null, error: null };
    if (this.single === "one") return copies[0] === undefined ? { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } } : { data: copies[0], error: null };
    return { data: copies, error: null };
  }

  then<TResult1 = ServerReply, TResult2 = never>(
    onfulfilled?: ((value: ServerReply) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.client.net.carry(() => this.run()).then(onfulfilled as never, onrejected as never) as PromiseLike<TResult1 | TResult2>;
  }
}

// supabase-js calls it `.single()`; the class keeps a non-clashing name internally.
(QueryBuilder.prototype as unknown as { single: () => unknown }).single = QueryBuilder.prototype.singleRow;

type Handler = { type: string; filter: { event?: string; table?: string }; callback: (payload: unknown) => void };

class FakeChannel {
  state: "closed" | "joining" | "joined" = "closed";
  private handlers: Handler[] = [];
  private statusCallback: ((status: string) => void) | null = null;
  private unsubscribeServer: (() => void) | null = null;

  constructor(
    private readonly client: FakeSupabaseClient,
    readonly topic: string,
  ) {}

  on(type: string, filter: { event?: string; table?: string }, callback: (payload: unknown) => void): this {
    this.handlers.push({ type, filter, callback });
    return this;
  }

  subscribe(callback?: (status: string) => void): this {
    this.statusCallback = callback ?? null;
    this.join();
    return this;
  }

  /** Joins (again): registers with the server and says SUBSCRIBED, like a socket (re)connect. */
  join(): void {
    if (this.client.net.isOffline) return;
    this.state = "joining";
    this.unsubscribeServer?.();
    this.unsubscribeServer = this.client.server.subscribe({
      userId: this.client.userId,
      topic: this.topic,
      deliver: (event) => this.deliver(event),
    });
    window.setTimeout(() => {
      if (this.state !== "joining") return;
      this.state = "joined";
      this.statusCallback?.("SUBSCRIBED");
    }, 0);
  }

  /** The socket dropped: nothing is delivered until it is back (events in between are lost). */
  drop(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.unsubscribeServer?.();
    this.unsubscribeServer = null;
    this.statusCallback?.("CLOSED");
  }

  close(): void {
    this.state = "closed";
    this.unsubscribeServer?.();
    this.unsubscribeServer = null;
    this.handlers = [];
  }

  private deliver(event: ChangeEvent): void {
    const net = this.client.net;
    void net.delay().then(() => {
      if (this.state !== "joined" || net.isOffline) return;
      for (const handler of this.handlers) {
        if (handler.type !== event.type) continue;
        if (event.type === "broadcast" && handler.filter.event !== event.event) continue;
        if (event.type === "postgres_changes") {
          if (handler.filter.table !== event.table) continue;
          if (handler.filter.event !== undefined && handler.filter.event !== "*" && handler.filter.event !== event.event) continue;
        }
        handler.callback(event.type === "broadcast" ? { type: "broadcast", event: event.event, payload: event.payload } : event.payload);
      }
    });
  }
}

export class FakeSupabaseClient {
  private readonly channels = new Set<FakeChannel>();
  private authListeners = new Set<(event: string, session: unknown) => void>();
  readonly session: { access_token: string; user: { id: string; email: string } };

  constructor(
    readonly server: FakeAvoraServer,
    readonly userId: string,
    readonly net: NetworkConditioner,
  ) {
    this.session = { access_token: `token-${userId}`, user: { id: userId, email: `${userId}@probe.test` } };
    net.onChange((online) => {
      for (const channel of this.channels) {
        if (online) channel.join();
        else channel.drop();
      }
    });
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(name: string, args: Record<string, unknown> = {}): PromiseLike<ServerReply> {
    return this.net.carry(() => this.server.rpc(this.userId, name, args));
  }

  channel(topic: string, _options?: unknown): FakeChannel {
    const channel = new FakeChannel(this, topic);
    this.channels.add(channel);
    return channel;
  }

  removeChannel(channel: FakeChannel): Promise<"ok"> {
    channel.close();
    this.channels.delete(channel);
    return Promise.resolve("ok");
  }

  removeAllChannels(): Promise<"ok"[]> {
    for (const channel of this.channels) channel.close();
    this.channels.clear();
    return Promise.resolve([]);
  }

  /** Every channel this app copy holds (tests read the joined state). */
  openChannels(): FakeChannel[] {
    return [...this.channels];
  }

  readonly realtime = {
    setAuth: (_token: string): void => undefined,
    isConnected: (): boolean => !this.net.isOffline,
  };

  readonly auth = {
    getSession: async () => ({ data: { session: this.session }, error: null }),
    getUser: async () => ({ data: { user: this.session.user }, error: null }),
    onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
      this.authListeners.add(callback);
      window.setTimeout(() => callback("INITIAL_SESSION", this.session), 0);
      return { data: { subscription: { unsubscribe: () => this.authListeners.delete(callback) } } };
    },
    signOut: async () => ({ error: null }),
    refreshSession: async () => ({ data: { session: this.session }, error: null }),
  };

  readonly storage = {
    from: (bucket: string) => ({
      upload: (path: string, blob: Blob, _options?: unknown) => this.net.carry(() => this.server.upload(this.userId, bucket, path, blob)),
      remove: (paths: string[]) => this.net.carry(() => this.server.removeObjects(bucket, paths)),
      createSignedUrl: (path: string) => this.net.carry(() => ({ data: { signedUrl: `blob:fake/${bucket}/${path}` }, error: null })),
      createSignedUrls: (paths: string[]) =>
        this.net.carry(() => ({ data: paths.map((path) => ({ path, signedUrl: `blob:fake/${bucket}/${path}`, error: null })), error: null })),
    }),
  };

  readonly functions = {
    invoke: (_name: string, _options?: unknown) => this.net.carry(() => ({ data: null, error: null })),
  };
}
