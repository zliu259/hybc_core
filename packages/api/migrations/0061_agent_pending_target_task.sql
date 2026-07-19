-- 0061_agent_pending_target_task.sql
-- rank5: 钉住 park 时解析出的审批任务身份，重放时只认这一条、且必须仍 pending。
--
-- 背景：agent 高危写在 handler 运行【之前】就被闸门 park 成待确认动作，真正解析「这是哪一条
-- 待办任务」原本发生在【重放】时——那已是员工看到确认卡片之后的几分钟。这段窗口内待办可能流转
-- （退回+重新提交会生成一条全新 task 行、id 不同；或签会推进），于是员工的确认被静默地落到了
-- 另一条任务上，并永久署上他的名字。故在 park 当刻就把解析出的 task 身份钉死。
--
-- 三列均可空——只有 agent 的 approval approve/reject 动作会写入它们；其它 kind 与历史行为 NULL。
-- 核心正确性只靠 target_task_id + 重放时 status='pending' 两者：退回/重提会让旧 id 移出 pending，
-- 钉住的 id 便过不了 pending 校验而被拒。node_instance_id / round 供卡片展示与纵深校验，非承重。
ALTER TABLE agent_pending_action ADD COLUMN target_task_id INTEGER;
ALTER TABLE agent_pending_action ADD COLUMN target_node_instance_id INTEGER;
ALTER TABLE agent_pending_action ADD COLUMN target_round INTEGER;
