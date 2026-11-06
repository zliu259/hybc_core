# APPROVAL_TIMEOUT 历史行清理方案

状态：**待 owner 同意后执行**。代码改动见 `checkApprovalTimeouts`（`packages/api/src/services/approval/engine.ts`）和迁移 `0091`。

## 结论

- 建议全部删除截止时间之前的 `APPROVAL_TIMEOUT` 行，不另做归档。这些行的内容（实例、节点、开始时间）都还在 `approval_node_instance` 里，多出来的只有每小时巡检的时间戳，没有人用，代码里也没有读取方。
- 预计释放约 **116 MB**，约占 D1 5GB 上限的 2.3%。并不紧急，但不修的话每年还会再涨约 300 MB。
- 必须先上线去重代码，再清理历史，否则删完还会继续涨。

## 每小时 2 行的原因

不是 `scheduled.ts` 重复调用。它虽然有两处调用，但 `wrangler.toml` 只配了三个 cron，每个都在前面的分支里返回了，第二处调用实际走不到。

真正的原因是同一个事件写了两次：

1. `publishEvent`（`services/event-bus.ts`）写一行，再投递到队列。
2. 队列消费者 `queue()`（`queue-handler.ts`）收到后，不管什么事件都先 `logEvent` 再写一行。

测试复现：2 个节点巡检 2 次，得到 8 行。按 3,558 行/天推算，生产上大约有 74 个超时节点在持续产生事件。

## 估算依据

下面的数字来自本地模拟，**没有查生产库**：用真实表结构和真实负载形状灌 49.7 万行，再看占用页数。

| 项目 | 估算值 |
| --- | --- |
| 总占用 | 约 116 MB（平均每行 244 字节） |
| 其中表数据 | 约 89 MB |
| 其中索引 `idx_event_log_type_created_at` | 约 27 MB |
| 不修时每年新增 | 约 130 万行，约 303 MB |
| 批次数 | 497 批，每批 1,000 行 |
| 耗时 | 约 15 到 35 分钟（每批一次 wrangler 调用，批间停 1 秒） |
| 计费写入 | 约 100 万 rows written（表和索引各算一次） |

**空间能否立刻退回还不确定。** SQLite 删除后的空页默认只进空闲列表，供之后的写入复用，文件不缩小；本地模拟也是这样（删 10 万行后 `page_count` 不变）。D1 文档没有说明生产环境的行为，只有 [workerd issue #1618](https://github.com/cloudflare/workerd/issues/1618) 里维护者在 2024 年提到生产开了 auto-vacuum，这一点没有得到确认。所以下面第 6 步先小批试删，看 `size_after` 有没有变化。就算不缩小，这些空页也会被后续写入复用，数据库在很长时间内不会再因此增长。

## 执行步骤

下面每一步都会读或写生产，**执行前都需要 owner 同意**。

1. 执行迁移，**必须在代码上线之前**：

   ```bash
   cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote --env prod
   ```

   迁移会给 `approval_node_instance` 加 `timeout_event_at`，并把当时已超时的节点打上标记，避免上线后集中补记一批。

   如果代码先上线，巡检会报 `no such column`。这种情况只记错误日志，不会影响同批的其它 cron 任务，等迁移跑完自动恢复。

2. 合并到 `main`（自动部署），记下部署完成的时刻，下面称为 `<部署时刻>`，格式如 `2026-11-07T00:00:00.000Z`。

3. 过一两个整点后确认噪音已停。以前每小时约 148 行，现在只有新超时的节点才有一行：

   ```sql
   SELECT COUNT(*) FROM event_log
   WHERE event_type = 'APPROVAL_TIMEOUT' AND created_at >= '<部署时刻>';
   ```

4. 记下恢复点。Time Travel 在付费档保留 30 天，无需提前备份；恢复会覆盖整个数据库、丢掉之后的所有写入，只用于极端情况：

   ```bash
   cd packages/api && npx wrangler d1 time-travel info hybcdg-prod-db --env prod
   ```

5. 只统计，不删除。脚本默认不写库，会输出实际行数、时间范围和数据库大小：

   ```bash
   cd packages/api && node scripts/cleanup-approval-timeout-events.mjs --before=<部署时刻> --remote
   ```

6. 试删 10 批（1 万行），看 `size_after` 有没有下降、线上有没有变慢：

   ```bash
   cd packages/api && node scripts/cleanup-approval-timeout-events.mjs --before=<部署时刻> --remote --execute --max-batches=10
   ```

7. 全量执行。建议放在北京时间夜间，中途失败可以直接重跑：

   ```bash
   cd packages/api && node scripts/cleanup-approval-timeout-events.mjs --before=<部署时刻> --remote --execute
   ```

8. 确认结果：再跑一次第 5 步应为 0 行，`https://api.hybcdg.com/api/v1/system/health` 返回 `ok=true`。在 `doc/开发记录.md` 记下实际删除行数和前后大小，把本文档移到 `docs/archive/`。

## 脚本的保护

`packages/api/scripts/cleanup-approval-timeout-events.mjs`：

- 事件类型写死在脚本里，只能删 `APPROVAL_TIMEOUT`，且只删 `--before` 之前的行。
- 默认只统计；`--execute` 才删除；`--local` 和 `--remote` 必须明确写一个。
- `--before` 必须是完整的 ISO 时间且不能晚于现在；每批最多 1,000 行，这是 [D1 文档](https://developers.cloudflare.com/d1/platform/limits/)建议的分批大小。
- 已用本地 D1 验证：范围外的行和其它事件类型不受影响，重跑安全。

## 可选：用真实数据核对

这些是只读查询，同样需要 owner 同意后再查生产。

确认「同一事件写两行」。同一事件的两行 `created_at` 和负载完全相同，预期几乎都是 `copies = 2`：

```sql
SELECT copies, COUNT(*) AS events FROM (
  SELECT COUNT(*) AS copies FROM event_log
  WHERE event_type = 'APPROVAL_TIMEOUT' AND created_at >= '2026-11-05T00:00:00.000Z'
  GROUP BY created_at, event_payload
) GROUP BY copies;
```

核对实际占用：

```sql
SELECT COUNT(*) AS total, SUM(LENGTH(event_payload)) AS payload_bytes,
       MIN(created_at) AS earliest, MAX(created_at) AS latest
FROM event_log WHERE event_type = 'APPROVAL_TIMEOUT';
```

## 没有处理的问题

`queue()` 的重复写入影响所有经过 `publishEvent` 的事件，不只是超时事件。这次只让 `APPROVAL_TIMEOUT` 绕开队列，其它事件类型仍然写两行，需要单独处理。
