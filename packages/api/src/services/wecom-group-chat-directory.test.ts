import { describe, expect, it } from "vitest";

import type { Env } from "../types/env";
import {
  listWeComGroupChats,
  syncExternalWeComGroupChats,
  upsertWeComGroupChat
} from "./wecom-group-chat-directory";

type GroupChatRow = {
  id: number;
  chat_id: string;
  chat_name: string;
  chat_type: string;
  owner_userid: string | null;
  source: string;
  webhook_secret_ref: string | null;
  status: string;
  raw_json: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

class GroupChatStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: GroupChatDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.params);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return this.db.all<T>(this.sql, this.params);
  }

  async run(): Promise<{ meta: { last_row_id: number; changes?: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class GroupChatDb {
  rows: GroupChatRow[] = [];
  private nextId = 1;

  prepare(sql: string) {
    return new GroupChatStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("WHERE chat_id = ?")) {
      const chatId = String(params[0]);
      return (this.rows.find((row) => row.chat_id === chatId) as T | undefined) ?? null;
    }

    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes("FROM wecom_group_chat_directory")) {
      const keyword = params.find(
        (item): item is string => typeof item === "string" && item.includes("%")
      );
      const normalized = keyword?.replaceAll("%", "").toLowerCase();
      const rows = this.rows.filter((row) => {
        if (row.status !== "active") return false;
        if (!normalized) return true;
        return (
          row.chat_id.toLowerCase().includes(normalized) ||
          row.chat_name.toLowerCase().includes(normalized)
        );
      });

      return { results: rows as T[] };
    }

    throw new Error(`Unhandled all SQL: ${sql}`);
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes("INSERT INTO wecom_group_chat_directory")) {
      const existing = this.rows.find((row) => row.chat_id === String(params[0]));
      if (existing) {
        existing.chat_name = String(params[1]);
        existing.chat_type = String(params[2]);
        existing.owner_userid = (params[3] as string | null) ?? null;
        existing.source = String(params[4]);
        existing.webhook_secret_ref = (params[5] as string | null) ?? null;
        existing.status = "active";
        existing.raw_json = (params[6] as string | null) ?? null;
        existing.last_synced_at = (params[7] as string | null) ?? null;
        existing.updated_at = String(params[9]);
        return { meta: { last_row_id: existing.id, changes: 1 } };
      }

      const row: GroupChatRow = {
        id: this.nextId++,
        chat_id: String(params[0]),
        chat_name: String(params[1]),
        chat_type: String(params[2]),
        owner_userid: (params[3] as string | null) ?? null,
        source: String(params[4]),
        webhook_secret_ref: (params[5] as string | null) ?? null,
        status: "active",
        raw_json: (params[6] as string | null) ?? null,
        last_synced_at: (params[7] as string | null) ?? null,
        created_at: String(params[8]),
        updated_at: String(params[9])
      };
      this.rows.push(row);
      return { meta: { last_row_id: row.id, changes: 1 } };
    }

    throw new Error(`Unhandled run SQL: ${sql}`);
  }
}

class MissingGroupChatMigrationDb {
  prepare() {
    throw new Error("no such table: wecom_group_chat_directory");
  }
}

const createEnv = () => ({ DB: new GroupChatDb() }) as unknown as Env & { DB: GroupChatDb };

describe("wecom group chat directory service", () => {
  it("upserts manual group chats and returns active dropdown options", async () => {
    const env = createEnv();

    const created = await upsertWeComGroupChat(env, {
      chat_id: "wr-group-1",
      chat_name: "东线项目群",
      chat_type: "internal",
      source: "manual",
      webhook_secret_ref: "prod-east"
    });
    await upsertWeComGroupChat(env, {
      chat_id: "wr-group-2",
      chat_name: "西线客户群",
      chat_type: "external_customer_group",
      source: "external_sync"
    });

    const rows = await listWeComGroupChats(env, { keyword: "东线" });

    expect(created).toMatchObject({
      chat_id: "wr-group-1",
      chat_name: "东线项目群",
      webhook_secret_ref: "prod-east"
    });
    expect(rows).toEqual([
      expect.objectContaining({
        chat_id: "wr-group-1",
        chat_name: "东线项目群"
      })
    ]);
  });

  it("returns an empty list before the migration has been applied", async () => {
    const env = { DB: new MissingGroupChatMigrationDb() } as unknown as Env;

    await expect(listWeComGroupChats(env)).resolves.toEqual([]);
  });

  it("syncs external customer groups through the provided fetcher", async () => {
    const env = createEnv();

    const result = await syncExternalWeComGroupChats(env, {
      fetcher: async () => ({
        errcode: 0,
        group_chat_list: [
          {
            chat_id: "wr-external-1",
            name: "客户群 A",
            owner: "manager-a",
            status: 0
          }
        ]
      })
    });

    expect(result).toMatchObject({ synced: 1, skipped: 0 });
    expect(env.DB.rows[0]).toMatchObject({
      chat_id: "wr-external-1",
      chat_name: "客户群 A",
      chat_type: "external_customer_group",
      owner_userid: "manager-a",
      source: "external_sync"
    });
  });
});
