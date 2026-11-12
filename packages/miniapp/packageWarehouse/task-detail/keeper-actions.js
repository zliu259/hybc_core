/** 任务详情页上库管的动作：派工、确认完成、退回补充、取消。在页面里用 Page({ ...keeperActions }) 展开。 */
const { whSend } = require("../common/wh-api");
const { toast, errorText, isConflict, confirmModal, promptModal } = require("../common/wh-ui");

module.exports = {
  /**
   * 库管动作的统一流程：成功提示并重新加载；409 提示后端的话并重新加载；其他失败留在原地。
   * @param {() => Promise<string>} action 返回成功时要提示的话
   */
  async runKeeperAction(action) {
    if (this.data.busy || !this.task) return;
    this.setData({ busy: true });
    try {
      toast(await action());
    } catch (error) {
      toast(errorText(error));
      if (!isConflict(error)) return;
    } finally {
      this.setData({ busy: false });
    }
    await this.load();
  },

  async onAssignPick(event) {
    const index = Number(event.detail && event.detail.value);
    const { userids, range } = this.data.assignee;
    if (!Number.isInteger(index) || index < 0 || index >= userids.length || !this.task) return;
    const userid = userids[index];
    if (userid === (this.task.assignee_userid || "")) return;
    const { id, version } = this.task;
    await this.runKeeperAction(async () => {
      await whSend("POST", `/task/${id}/assign`, { version, assignee_userid: userid || null });
      return userid ? `已派给 ${range[index]}` : "已取消派工";
    });
  },

  async confirmDone() {
    if (this.data.busy || !this.task) return;
    if (!(await confirmModal({ title: "确认这个任务已完成？", confirmText: "确认完成" }))) return;
    const { id, version } = this.task;
    await this.runKeeperAction(async () => {
      const result = await whSend("POST", `/task/${id}/confirm`, { version });
      return result && result.data && result.data.followup_task_id
        ? "已完成，检查不合格，已生成维修任务"
        : "已完成";
    });
  },

  async sendBack() {
    if (this.data.busy || !this.task) return;
    const note = await promptModal({ title: "退回补充", placeholder: "写清楚要补什么" });
    if (note === null) return;
    if (!note) {
      toast("请写退回要求");
      return;
    }
    const { id, version } = this.task;
    await this.runKeeperAction(async () => {
      await whSend("POST", `/task/${id}/send-back`, { version, review_note: note });
      return "已退回";
    });
  },

  async cancelTask() {
    if (this.data.busy || !this.task) return;
    // 取消阻塞任务等于放开设备，先让库管看清楚
    if (Number(this.task.blocking) === 1) {
      const sure = await confirmModal({
        title: "取消任务",
        content: "取消后这台设备不再被这个任务卡住，可以发出。确定要取消吗？",
        confirmText: "继续"
      });
      if (!sure) return;
    }
    const reason = await promptModal({ title: "取消原因", placeholder: "为什么取消" });
    if (reason === null) return;
    if (!reason) {
      toast("请写取消原因");
      return;
    }
    const { id, version } = this.task;
    await this.runKeeperAction(async () => {
      await whSend("POST", `/task/${id}/cancel`, { version, reason });
      return "任务已取消";
    });
  }
};
