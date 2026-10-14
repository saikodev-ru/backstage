/**
 * Ambient types for bun-specific APIs used by the chat microservice.
 * (bun runs the service natively; these declarations keep TS tooling happy
 *  because the root tsconfig does not include bun-types.)
 */

declare module 'bun:sqlite' {
  export interface SqliteRunResult {
    changes: number
    lastInsertRowid: number | bigint
  }

  export interface SqliteStatement<Row = unknown> {
    run(...params: unknown[]): SqliteRunResult
    get(...params: unknown[]): Row | null
    all(...params: unknown[]): Row[]
    finalize(): void
  }

  export class Database {
    constructor(path: string, options?: { readonly?: boolean; create?: boolean; safeIntegers?: boolean })
    exec(sql: string): void
    query<Row = unknown>(sql: string): SqliteStatement<Row>
    prepare<Row = unknown>(sql: string): SqliteStatement<Row>
    transaction<T>(fn: () => T): () => T
    close(): void
  }
}

declare global {
  interface ImportMeta {
    /** Directory of the current module (bun builtin). */
    readonly dir: string
  }

  namespace Bun {
    interface SpawnOptions {
      cwd?: string
      env?: Record<string, string | undefined>
      stdin?: 'ignore' | 'inherit' | 'pipe'
      stdout?: 'ignore' | 'inherit' | 'pipe'
      stderr?: 'ignore' | 'inherit' | 'pipe'
    }
    interface Subprocess {
      readonly pid: number | undefined
      exited: Promise<number>
      kill(signal?: number | string): void
    }
    function spawn(command: string[], options?: SpawnOptions): Subprocess
  }

  /** Global bun runtime object (частичное объявление используемых API). */
  var Bun: {
    spawn: typeof Bun.spawn
  }
}

export {}
