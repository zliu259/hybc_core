# 大陆访问优化 - Worker 主入口与 Azure HK Bridge 兜底方案

## 1. 背景与目标

### 背景
- 当前 API 主运行时为 `Cloudflare Workers`，主域名入口保持不变。
- 员工主要位于中国大陆，日常访问大部分时间正常，但在部分网络环境下会出现明显慢请求，尤其是 `IPv4-only` 场景。
- 现有 `bridge` 服务已部署在 Azure Hong Kong，当前主要用于企业微信回调与企业微信出口代理，不承担通用业务 API 入口能力。

### 问题定义
- 当前瓶颈主要不是 Worker 内部业务处理，而是大陆用户到 Cloudflare 边缘入口链路的偶发高延迟与超时。
- 单一入口意味着客户端只能等待 Worker 恢复，缺乏网络层绕行能力。
- 如果直接把 bridge 改成全量主入口，会把一个旁路组件升级成主链路组件，增加运维和容量风险。

### 目标
- 保持 `Cloudflare Workers` 为主入口，不改变核心后端部署形态。
- 将 bridge 兜底入口设计为可扩展的 `relay pool`，允许未来部署多台转发服务器，而不是只绑定单一节点。
- 在 Worker 慢请求或不可达时，从 relay pool 中选择可用且负载未超阈值的 relay 承接流量。
- 如果所有 relay 都不适合承接请求，则停止 relay fallback，继续等待 Worker，避免固定 IP relay 因回退流量踩踏而过载。
- 以最小架构增量提升大陆员工访问稳定性，优先解决高延迟、超时和偶发不可达问题。
- 为后续是否升级到 `Cloudflare China Network` 或合规大陆入口提供观测依据。

### 非目标
- 本方案不在本阶段建设中国大陆实体节点。
- 本方案不在本阶段迁移业务主数据或鉴权主逻辑到 bridge。
- 本方案不在本阶段改变 D1、KV、R2、Queue 的主归属，bridge 仅作为 API 转发和局部旁路能力。

## 2. 设计原则

- 主链路最小改动：业务核心仍在 Worker，bridge 不承接业务编排与状态持久化。
- 失败可回退：任何时候都可以关闭 fallback，恢复为 Worker-only。
- 优先保护写请求：写操作默认谨慎兜底，必须具备幂等保护后再放开自动重试。
- 观测先行：没有大陆链路指标之前，不做激进全量切流。
- 面向中国大陆实际网络：方案重点针对跨境链路抖动、IPv4-only 入口不稳、局部地区/运营商路径异常。

## 3. 目标架构

### 3.1 逻辑拓扑

```text
Mainland User
   |
   | primary
   v
api.hybcdg.com -> Cloudflare Workers -> D1 / KV / R2 / Queue
   |
   | fallback on timeout / high latency / reachability failure
   v
relay pool manifest
   |
   | choose first healthy + not overloaded relay
   +--> api-hk-1.hybcdg.com -> Relay #1 -> Cloudflare Workers
   +--> api-hk-2.hybcdg.com -> Relay #2 -> Cloudflare Workers
   +--> api-sg-1.hybcdg.com -> Relay #3 -> Cloudflare Workers
   |
   +--> if none eligible: stop relaying and stay on Worker path
```

### 3.2 角色分工

#### Worker 主入口
- 继续作为默认 API 域名和标准服务入口。
- 承担全部业务鉴权、路由、校验、数据读写与异步任务分发。
- 暴露健康检查和链路诊断接口，供客户端和监控系统判断主入口质量。

#### Relay pool 兜底入口
- bridge 兜底入口设计为一个可扩展 relay pool，当前首节点可继续使用现有 Azure HK bridge。
- 每个 relay 拥有独立域名、健康状态、负载指标、可承接能力标识与优先级。
- relay 仅作为反向代理/安全转发层，透传鉴权信息、请求体、响应头和 trace 信息。
- relay 负责对 Worker 的上游请求超时、重试、并发、连接池和限流控制。
- 每个 relay 独立暴露健康检查、版本信息、转发延迟、错误计数和负载信号。

#### Web / 小程序客户端
- 默认调用 Worker 主入口。
- 当触发超时、高延迟或特定网络错误时，根据 relay pool 清单选择可用 relay。
- 如果当前 relay 负载过高或不健康，则尝试下一个 relay。
- 如果所有 relay 都不满足条件，则停止 relay fallback，继续等待 Worker 结果或按原始失败策略返回，避免踩踏 relay。
- 记录 fallback 触发原因、relay 选择结果、跳过原因、trace_id 和耗时。

## 4. 流量策略

### 4.1 基础策略
- 默认模式：`Worker primary + relay pool passive fallback`。
- 发布初期仅对中国大陆员工启用，不影响其他地区用户。
- fallback 触发条件以客户端判定为主，避免依赖 DNS 缓存刷新或 Cloudflare 内部二次转发。

### 4.2 relay pool 选择规则

- relay pool 由配置清单描述，至少包含：`id`、`base_url`、`region`、`priority`、`enabled`、`max_inflight`、`load_threshold`、`cooldown_until`、`supports_write_fallback`。
- 客户端选择 relay 时，必须同时判断 `健康状态` 与 `负载状态`，不能只看健康心跳。
- relay 满足以下全部条件才有资格被选中：
  - `enabled = true`
  - 最近一次健康检查为 `up`
  - 负载指标未超过阈值
  - 未处于熔断/冷却窗口
  - 当前请求类型被该 relay 能力允许
- 选择顺序建议为：
  - 先按 `priority`
  - 同优先级采用 `randomized least-utilized`，避免所有请求挤向单一最优 relay
  - 再按最近失败次数和冷却状态剔除
- 若当前候选 relay 不可用，则向后尝试下一个 relay。
- relay 尝试必须是顺序且有上限的，首阶段建议每次请求最多尝试 `2-3` 个 relay，禁止并行 fan-out。
- 若所有 relay 都不可用或已过载，则本次请求不再转发 relay，直接保留 Worker 路径，避免把兜底层压垮。

### 4.3 入口选择策略

#### 读请求
- `GET`、安全查询类请求优先支持自动 fallback。
- 触发条件建议包含：连接失败、TLS 建连失败、超时、首包超时、响应时间超过阈值。
- 建议首阶段阈值：`2.5s ~ 3s`，后续以真实数据调整。
- 若 Worker 已进入等待阶段，只允许在 relay pool 中顺序尝试有限个候选 relay，避免无限级联重试。

#### 写请求
- `POST`、`PUT`、`PATCH`、`DELETE` 默认不做无脑自动重试。
- 仅在以下条件满足时允许自动 fallback：
  - 请求具备幂等键。
  - 服务端可识别重复提交。
  - 业务方确认该接口支持安全重放。
- 对未完成幂等改造的写请求，首阶段只做手动或受控 fallback，不做自动双发。
- 写请求在 relay pool 中必须额外检查 `supports_write_fallback`，不允许被所有 relay 默认接收。

### 4.4 手动与自动结合
- Web 端支持静默自动 fallback。
- 小程序端考虑网络环境复杂，可先支持配置开关和显式降级提示，再逐步过渡到自动 fallback。
- 管理后台保留 feature flag，支持按用户、角色、地区或平台灰度打开 fallback。

## 5. Relay 负载治理

### 5.1 负载信号

- 每个 relay 需要暴露轻量状态接口，除 `ok` 外至少包含：
  - `inflight_requests`
  - `cpu_percent` 或等价负载指标
  - `memory_percent`
  - `upstream_timeout_rate`
  - `queue_depth`（如果存在内部排队）
  - `overloaded` 布尔值
- 首阶段客户端不直接计算系统负载，只消费 relay 自身给出的可承接结论和少量关键指标。

### 5.2 过载判定

- 任何 relay 出现以下任一情况时，标记为本轮不可选：
  - `overloaded = true`
  - `inflight_requests` 超过节点声明阈值
  - 最近短窗口内 5xx 或上游超时率超阈值
  - 健康接口超时或状态未知
- 对被判定过载的 relay，进入短暂冷却窗口，避免所有客户端在同一时间反复探测同一节点。

### 5.3 陈旧信号处理

- relay 状态信号必须带有时间戳和短 TTL，超过 TTL 的状态视为 `stale`。
- 对 `stale` relay 默认按不可选处理，而不是乐观继续发送流量。
- 仅当全部 relay 都不可选时，才允许极低频率的探测性尝试，避免因状态过期导致永久黑洞。

### 5.4 失败策略

- 本方案对 relay 层采用 `fail-closed for relay fallback`：
  - relay 不可选时，不继续强行把请求塞进 relay。
  - 不因为 relay 不可用而放弃 Worker 主入口。
- 该策略的目标是保护固定 IP relay 节点，避免“Worker 慢 + relay 满载”时出现级联雪崩。

## 6. 核心设计点

### 6.1 统一鉴权与会话
- 客户端对 Worker 和 relay 使用相同 JWT/会话模型。
- relay 不做独立登录态，不持久化业务会话。
- relay 只负责透传认证头、必要转发头和链路追踪头。

### 6.2 幂等与重复提交控制
- 对写接口补齐 `Idempotency-Key` 支持。
- Worker 侧对关键写操作建立幂等记录或去重窗口。
- relay 禁止对非幂等写请求执行隐式重试。

### 6.3 可观测性
- 所有入口统一注入 `trace_id`。
- 最少采集以下指标：
  - Worker 主入口成功率、p50/p95/p99、超时率。
  - relay pool 维度成功率、p50/p95/p99、上游 Worker 耗时、relay 自身耗时。
  - 每个 relay 的 inflight、过载状态、冷却状态、被跳过次数。
  - fallback 触发次数、触发原因、按地区/平台/运营商聚合。
  - 写请求重复命中率、幂等冲突率。

### 6.4 失败隔离
- relay 不缓存敏感业务响应。
- relay 设置并发上限、上游超时、熔断与限流，避免 Worker 异常时被回退流量压垮。
- 如果单个 relay 不健康或过载，客户端应快速跳过到下一个 relay，而不是持续重打同一节点。
- 如果整个 relay pool 不可选，客户端应快速回退到 Worker-only 模式。

## 7. 实现节点

### 节点 A - relay pool 配置与入口治理
- 定义 relay pool 清单结构，兼容未来多节点部署。
- 当前先纳入 Azure HK bridge，后续可扩展到更多 HK/SG/JP relay。
- 为每个 relay 分配独立域名、证书、DNS、反向代理和来源限制。
- 为客户端预留主入口、relay pool、优先级、开关和冷却配置字段。

### 节点 B - relay 通用 API 反向代理能力
- 在现有 bridge 服务上新增通用 API 代理路由。
- 透传方法、路径、查询参数、请求体、鉴权头和 trace 头。
- 增加上游超时、连接池、限流、错误封装和健康探针。
- 对外提供负载状态接口和可承接能力描述。

### 节点 C - Worker 入口健康与诊断能力
- 暴露轻量健康检查、网络诊断或版本信息接口。
- 对关键写请求补齐幂等支持。
- 对来自 relay 的请求补充来源标识和审计字段。

### 节点 D - Web relay pool fallback 接入
- 在 `packages/web` 的 API 请求封装层实现主入口优先、relay pool 兜底。
- 按接口类型区分读请求自动 fallback 与写请求受控 fallback。
- 加入 relay 负载判定、节点跳过、冷却窗口和最大尝试次数控制。
- 记录客户端链路指标、relay 命中原因和跳过原因。

### 节点 E - 小程序 relay pool fallback 接入
- 在 `packages/miniapp` 的请求封装层接入 relay pool 配置。
- 先上线可配置的手动/半自动降级，再逐步灰度自动 fallback。
- 结合企业微信内环境做网络兼容测试。
- 复用现有 base URL fallback 模式，扩展为带 relay 状态过滤的候选列表。

### 节点 F - 监控、灰度与运维
- 在服务监控中心加入主入口与 relay pool 双入口指标。
- 增加 feature flag 与灰度控制。
- 形成发布、回滚、故障切换和容量预案。

## 8. 开发计划

### Phase A - 方案落地与基线采样（3-5 天）

#### 目标
- 明确入口配置、指标口径、灰度范围和失败判定阈值。

#### 任务
- 定义 Web/小程序的 `relay pool` 配置结构。
- 确认 Worker 健康接口与 relay 状态接口契约。
- 梳理读写接口分类和幂等改造优先级。
- 建立大陆地区网络观测样本与验收阈值。

#### 交付物
- relay pool 配置模型。
- fallback 判定规则。
- 首批幂等改造接口清单。

### Phase B - relay API 代理能力（4-6 天）

#### 目标
- 让 Azure HK bridge 首节点具备可控、可监控、可灰度的通用 API 转发能力，并预留多 relay 扩展结构。

#### 任务
- 新增通用代理入口。
- 补齐安全校验、来源限制、限流与日志。
- 增加上游 Worker 超时、错误映射和 trace 透传。
- 补齐 relay 健康、负载与指标接口。

#### 交付物
- 通用 API relay 首版上线。
- relay 自身监控可见。

### Phase C - Worker 适配与幂等加固（3-5 天）

#### 目标
- 让 Worker 能安全接收 bridge 转发流量，并对关键写请求提供重放保护。

#### 任务
- 新增/增强 relay 来源识别与审计。
- 对首批高价值写接口接入幂等键。
- 补齐健康、版本、链路诊断接口。

#### 交付物
- Worker 对 relay 流量透明兼容。
- 首批写接口可安全 fallback。

### Phase D - Web / 小程序 relay pool fallback（5-7 天）

#### 目标
- 在前端请求层完成双入口切换与灰度控制。

#### 任务
- Web 封装自动 relay pool fallback。
- 小程序封装半自动/自动 relay pool fallback。
- 采集客户端链路指标。
- 增加 feature flag 与远程配置联动。

#### 交付物
- Web fallback 可用。
- 小程序 fallback 可灰度。

### Phase E - 验收、灰度与发布（3-5 天）

#### 目标
- 在有限用户范围内确认大陆访问稳定性改善，并准备全量启用或回滚。

#### 任务
- 按用户组灰度放量。
- 对比 Worker-only 与 fallback 模式下的 p95/p99、超时率、失败率。
- 执行 relay down、relay overload、Worker slow、写请求重试、配置回滚等演练。
- 补齐运维手册、故障处理手册和发布检查项。

#### 交付物
- 灰度结果报告。
- 发布/回滚清单。
- 是否进入全量启用的决策结论。

## 9. Task List

### 9.1 架构与配置
- [ ] 确认 `api.hybcdg.com` 与 relay pool 域名策略。
- [ ] 设计客户端远程配置结构：主入口、relay pool、地区开关、平台开关。
- [ ] 定义 fallback 错误码、超时阈值与日志字段。
- [ ] 定义 relay 元数据字段：优先级、能力、冷却时间、负载阈值、最大并发。

### 9.2 relay 服务
- [ ] 为 `bridge` 新增通用 API 代理路由。
- [ ] 支持方法、路径、查询参数、请求体、鉴权头和 trace 头透传。
- [ ] 增加上游超时、连接池、限流、熔断和错误映射。
- [ ] 增加 relay 健康接口、版本接口、负载状态接口与指标采集。
- [ ] 增加 relay 访问日志与异常告警。
- [ ] 增加节点级过载保护和冷却窗口。

### 9.3 Worker 服务
- [ ] 新增 relay 来源标识、审计字段和链路日志。
- [ ] 增加健康检查与诊断接口。
- [ ] 为首批关键写接口接入幂等键与重复提交保护。
- [ ] 评估哪些接口允许自动 fallback，哪些接口仅允许手动重试。

### 9.4 Web 客户端
- [ ] 在 API 封装层实现主入口优先、relay pool 兜底。
- [ ] 为只读请求接入自动 fallback。
- [ ] 为写请求接入幂等键或关闭自动 fallback。
- [ ] 增加 relay 选择器：按优先级、健康状态、负载状态、冷却状态选择节点。
- [ ] 上报客户端超时、网络异常、fallback 命中原因、relay 跳过原因和入口选择结果。

### 9.5 小程序客户端
- [ ] 在请求封装层支持 relay pool 配置。
- [ ] 首阶段支持手动/半自动降级。
- [ ] 第二阶段灰度自动 fallback。
- [ ] 验证企业微信内网络环境差异与兼容性。

### 9.6 监控与发布
- [ ] 在监控中心展示 Worker 与 relay pool 状态。
- [ ] 增加 fallback 命中率和大陆链路趋势图。
- [ ] 增加每个 relay 的 inflight、过载、冷却和跳过率图表。
- [ ] 输出发布检查表、回滚清单和故障演练记录。
- [ ] 形成是否继续推进中国大陆合规入口的决策模板。

## 10. 验收标准

- 大陆目标用户在灰度期内，`p95/p99` 和超时率相较 Worker-only 明显改善。
- 单个 relay 异常或过载不会导致主链路不可用，关闭 feature flag 后可立即回退到 Worker-only。
- 当全部 relay 过载或不可用时，客户端会停止 relay fallback，而不是继续挤压固定 IP 节点。
- 首批允许自动 fallback 的写接口全部通过幂等与重复提交验证。
- 服务监控中心可区分 Worker 与 relay pool 两条入口链路，并看到 relay 节点级状态。

## 11. 风险与应对

| 风险 | 说明 | 应对 |
|------|------|------|
| relay 成为新瓶颈 | 回退流量集中到单个 relay，可能打爆固定 IP 节点 | relay pool、多节点扩容、并发上限、限流、熔断、冷却窗口 |
| 写请求重复提交 | 自动 fallback 导致多次写入 | 幂等键、服务端去重、写请求分级放开 |
| 客户端误判过多 | 阈值设置不合理导致频繁切换 | 先灰度、按平台分阈值、基于真实数据调优 |
| 指标不完整 | 无法证明方案是否有效 | 发布前补齐客户端和服务端双侧观测 |
| 误把兜底做成主链路 | relay 承担过多业务逻辑，维护复杂度陡增 | 严格限制 relay 为转发层，不承接业务持久化 |
| 负载信号失真 | 客户端拿到过期状态，误选过载 relay | 短 TTL、节点自报 overloaded、冷却窗口、失败快速剔除 |
| Relay 抢占不均 | 所有请求集中命中同一节点 | randomized least-utilized、顺序有限尝试、节点冷却 |
| 大陆问题长期无解 | HK relay 改善有限 | 以数据为依据，后续再评估 China Network 或合规大陆入口 |

## 12. 后续决策门

当以下任一情况出现时，启动下一阶段评估：
- relay pool 兜底后，大陆 `p99` 仍不可接受。
- 某些省份/运营商长期高失败率，且 HK 路径改善有限。
- 业务进入强 SLA 阶段，需要更稳定的大陆入口保障。

下一阶段可选项：
- `Cloudflare China Network`（前提：预算、Enterprise 合同、ICP 路径可行）。
- 合规的中国大陆入口层或转发层（前提：ICP备案/许可、等保、跨境数据合规准备完成）。
