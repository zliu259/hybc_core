-- 0086_legacy_contract_handler_userid.sql
-- 存量合同经办人字段治理（owner 2026-08-16）：旧财务系统导入的合同
-- handler_userid 写的是中文姓名而非企微 userid，导致发单台「只看我的合同」、
-- 合同编辑表单经办人回显等按登录 userid 精确匹配的逻辑对全部存量合同失效。
-- 映射依据 2026-08-16 企微通讯录快照（wecom:contact-book:v1），仅取唯一同名
-- 命中；李月平(59条)/郭元玲(1条) 通讯录已无此人（离职），保持原值不动。
-- 守卫条件限定 legacy 行 + 原值精确匹配，幂等可重复执行；本地 mock 库无
-- legacy 数据自然空跑。
UPDATE contract SET handler_userid = 'PangYueFeng' WHERE handler_userid = '庞越峰' AND legacy_data_id IS NOT NULL;
UPDATE contract SET handler_userid = 'LiuPeng' WHERE handler_userid = '刘鹏' AND legacy_data_id IS NOT NULL;
UPDATE contract SET handler_userid = 'LiuZhiYong' WHERE handler_userid = '刘志勇' AND legacy_data_id IS NOT NULL;
UPDATE contract SET handler_userid = 'LiuKun' WHERE handler_userid = '刘昆' AND legacy_data_id IS NOT NULL;
UPDATE contract SET handler_userid = 'LiZhen' WHERE handler_userid = '李震' AND legacy_data_id IS NOT NULL;
UPDATE contract SET handler_userid = 'HengYueBaiChuanDingGuanLiuShaoHai' WHERE handler_userid = '刘绍海' AND legacy_data_id IS NOT NULL;
UPDATE contract SET handler_userid = 'XiaoLianZhong' WHERE handler_userid = '肖连忠' AND legacy_data_id IS NOT NULL;
UPDATE contract SET handler_userid = 'LiuZiHao' WHERE handler_userid = '刘子昊' AND legacy_data_id IS NOT NULL;
UPDATE contract SET handler_userid = 'GangTieZhangChengTieLuDingGuan_1' WHERE handler_userid = '刘相余' AND legacy_data_id IS NOT NULL;
UPDATE contract SET handler_userid = 'LuShuMing' WHERE handler_userid = '鹿树明' AND legacy_data_id IS NOT NULL;
