/**
 * 多文件上传队列：每个文件独立走完，一个失败不影响其他，失败的单独重试。
 * 只管排队和状态，真正的上传由 uploadOne 做，不碰 wx，node 可以直接测。
 */
const isSameFile = (a, b) => a.name === b.name && a.size === b.size;

const createUploadQueue = ({ concurrency, uploadOne, onChange }) => {
  let items = [];
  let sequence = 0;

  const notify = () => {
    if (onChange) onChange(items.slice());
  };

  const patchItem = (localId, patch) => {
    items = items.map((item) => (item.localId === localId ? { ...item, ...patch } : item));
  };

  const runItem = (localId) => {
    patchItem(localId, { status: "uploading", error: null });
    const current = items.find((item) => item.localId === localId);
    let running;
    try {
      running = Promise.resolve(uploadOne(current));
    } catch (error) {
      running = Promise.reject(error);
    }
    running
      .then(() => {
        patchItem(localId, { status: "done", error: null });
      })
      .catch((error) => {
        patchItem(localId, { status: "failed", error: (error && error.message) || "上传失败" });
      })
      .then(() => {
        notify();
        pump();
      });
  };

  const pump = () => {
    const uploading = items.filter((item) => item.status === "uploading").length;
    const waiting = items.filter((item) => item.status === "waiting");
    waiting.slice(0, Math.max(concurrency - uploading, 0)).forEach((item) => runItem(item.localId));
    notify();
  };

  return {
    /** existing 是页面上已有的附件 {name, size}。名称和大小都相同的跳过，列在 skipped 里。 */
    add(files, existing = []) {
      const skipped = [];
      files.forEach((file) => {
        const inQueue = items.some((item) => item.status !== "failed" && isSameFile(item, file));
        if (inQueue || existing.some((item) => isSameFile(item, file))) {
          skipped.push(file.name);
          return;
        }
        sequence += 1;
        items = [
          ...items.filter((item) => !(item.status === "failed" && isSameFile(item, file))),
          { ...file, localId: `u${sequence}`, status: "waiting", error: null }
        ];
      });
      pump();
      return { skipped };
    },

    retry(localId) {
      const target = items.find((item) => item.localId === localId);
      if (!target || target.status !== "failed") return;
      patchItem(localId, { status: "waiting", error: null });
      pump();
    },

    /** 去掉失败的文件。一直传不上去时（比如超过数量）不能卡住提交。 */
    dismiss(localId) {
      const target = items.find((item) => item.localId === localId);
      if (!target || target.status !== "failed") return;
      items = items.filter((item) => item.localId !== localId);
      notify();
    },

    getItems: () => items.slice(),

    isBusy: () => items.some((item) => item.status === "waiting" || item.status === "uploading")
  };
};

module.exports = { createUploadQueue };
