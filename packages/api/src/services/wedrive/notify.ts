/**
 * 镜像暂停时给超管发一条企微文本消息。
 * 这是唯一的提醒：暂停之后只有人点「恢复」才继续，没人知道的话资料就一直不进微盘。
 * 发不出去只记日志，不影响暂停本身。
 */
import type { Env } from "../../types/env";
import { fetchWeComAccessToken, weComErrorMessage } from "../wecom-api";
import { fetchViaBridgeStrict } from "../wecom-approval-push";
import { fetchWeComTags, listUsersInTag, parseRoleTagMapping } from "../wecom-role";

interface WeComSendReply {
  errcode?: number;
  errmsg?: string;
}

/** super_admin 对应的企微标签里的人，按 userid 排好。 */
const listSuperAdmins = async (env: Env, accessToken: string): Promise<string[]> => {
  const tagNames = new Set(parseRoleTagMapping(env.WECHAT_ROLE_TAG_MAPPING).super_admin);
  const tags = (await fetchWeComTags(env, accessToken)).filter((tag) => tagNames.has(tag.tagname));
  const members = new Set<string>();
  for (const tag of tags) {
    for (const userid of await listUsersInTag(env, accessToken, tag.tagid)) members.add(userid);
  }
  return [...members].sort();
};

export const pausedNoticeText = (reason: string): string =>
  `微盘镜像已暂停：${reason}。到 库房 → 设置 里处理。`;

/** 永不抛出。 */
export const notifyMirrorPaused = async (env: Env, reason: string): Promise<void> => {
  try {
    if (!env.WECHAT_AGENT_ID) throw new Error("WECHAT_AGENT_ID is not configured");
    const accessToken = await fetchWeComAccessToken(env);
    const userids = await listSuperAdmins(env, accessToken);
    if (userids.length === 0) {
      console.error("微盘镜像暂停通知没发：超管标签里没有人");
      return;
    }
    const reply = await fetchViaBridgeStrict<WeComSendReply>(
      env,
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        body: {
          touser: userids.join("|"),
          msgtype: "text",
          agentid: Number(env.WECHAT_AGENT_ID),
          text: { content: pausedNoticeText(reason) }
        }
      }
    );
    if (reply.errcode !== 0) {
      throw new Error(weComErrorMessage(reply.errmsg, "Failed to send WeCom text message"));
    }
  } catch (error) {
    console.error("微盘镜像暂停通知发送失败", error);
  }
};
