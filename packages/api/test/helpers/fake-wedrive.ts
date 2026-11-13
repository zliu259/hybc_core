import { createSha1Stream } from "../../src/services/sha1-state";

// 内存里的假微盘：只认 cgi-bin/wedrive/ 下面这些接口，按 2026-11-12 探测到的真实规则核对分块上传的摘要。
// 测试里所有微盘调用都走它，不许真的调企微。

const BLOCK = 2 * 1024 * 1024;
const DIRECT_LIMIT = 10 * 1024 * 1024;

const decodeBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** "a.pdf" → "a(1).pdf"：模拟微盘对重名的处理（真实行为没实测过，这里按最坏情况：悄悄改名） */
const renamed = (name, n) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}(${n})${name.slice(dot)}` : `${name}(${n})`;
};

export const createFakeWedrive = (options = {}) => {
  let seq = 0;
  let hintSeq = 0;
  const nextId = (prefix) => {
    seq += 1;
    return `${prefix}.${seq}`;
  };
  /** spaceid → { name, members } */
  const spaces = new Map();
  /** fileid → { fileid, spaceid, fatherid, file_name, file_type, file_size, sha } */
  const nodes = new Map();
  const uploads = new Map();
  /** 发过的调用：{ api, body }，分片内容只留长度 */
  const calls = [];
  /** 推过的卡片（文件名） */
  const cards = [];
  let failures = [];
  /** 这些整文件 SHA1 会命中秒传 */
  const instantShas = new Set();
  const listPageSize = options.listPageSize ?? 1000;

  const ok = (extra = {}) => ({ errcode: 0, errmsg: "ok", ...extra });
  const err = (errcode, errmsg) => ({ errcode, errmsg });

  const siblings = (spaceid, fatherid) =>
    [...nodes.values()].filter((node) => node.spaceid === spaceid && node.fatherid === fatherid);

  const freeName = (spaceid, fatherid, name, ignoreId = null) => {
    const taken = new Set(
      siblings(spaceid, fatherid)
        .filter((node) => node.fileid !== ignoreId)
        .map((node) => node.file_name)
    );
    if (!taken.has(name)) return name;
    for (let n = 1; ; n += 1) {
      if (!taken.has(renamed(name, n))) return renamed(name, n);
    }
  };

  const addNode = (spaceid, fatherid, name, type, size = 0, sha = null) => {
    const fileid = nextId(type === 1 ? `${spaceid}_d` : `${spaceid}_f`);
    nodes.set(fileid, {
      fileid,
      spaceid,
      fatherid,
      file_name: freeName(spaceid, fatherid, name),
      file_type: type,
      file_size: size,
      sha
    });
    return fileid;
  };

  const parentExists = (spaceid, fatherid) =>
    spaces.has(spaceid) && (fatherid === spaceid || nodes.get(fatherid)?.file_type === 1);

  const removeTree = (fileid) => {
    for (const child of [...nodes.values()].filter((node) => node.fatherid === fileid)) {
      removeTree(child.fileid);
    }
    nodes.delete(fileid);
  };

  const sha1Of = (bytes) => {
    const sha = createSha1Stream();
    sha.update(bytes);
    return sha.digestHex();
  };

  const handlers = {
    space_create: (body) => {
      const spaceid = nextId("s.fake");
      spaces.set(spaceid, { name: body.space_name, members: [...(body.auth_info ?? [])] });
      return ok({ spaceid });
    },
    space_acl_add: (body) => {
      const space = spaces.get(body.spaceid);
      if (!space) return err(640001, "space not exist");
      space.members = [...space.members, ...(body.auth_info ?? [])];
      return ok();
    },
    file_create: (body) => {
      if (!parentExists(body.spaceid, body.fatherid)) return err(640002, "father not exist");
      if (body.file_type !== 1) return err(40058, "only folders in this fake");
      return ok({ fileid: addNode(body.spaceid, body.fatherid, body.file_name, 1) });
    },
    file_list: (body) => {
      if (!parentExists(body.spaceid, body.fatherid)) return err(640002, "father not exist");
      const all = siblings(body.spaceid, body.fatherid).sort((a, b) =>
        a.file_name < b.file_name ? -1 : 1
      );
      const start = Number(body.start ?? 0);
      const limit = Math.min(Number(body.limit ?? 1000), listPageSize);
      const page = all.slice(start, start + limit);
      return ok({
        has_more: start + limit < all.length,
        next_start: start + page.length,
        file_list: { item: page.map((node) => ({ ...node })) }
      });
    },
    file_rename: (body) => {
      const node = nodes.get(body.fileid);
      if (!node) return err(640003, "file not exist");
      nodes.set(node.fileid, {
        ...node,
        file_name: freeName(node.spaceid, node.fatherid, body.new_name, node.fileid)
      });
      return ok();
    },
    file_move: (body) => {
      for (const fileid of body.fileid ?? []) {
        const node = nodes.get(fileid);
        if (!node) return err(640003, "file not exist");
        if (!parentExists(node.spaceid, body.fatherid)) return err(640002, "father not exist");
        nodes.set(fileid, {
          ...node,
          fatherid: body.fatherid,
          file_name: freeName(node.spaceid, body.fatherid, node.file_name, fileid)
        });
      }
      return ok();
    },
    file_delete: (body) => {
      for (const fileid of body.fileid ?? []) {
        if (!nodes.has(fileid)) return err(640003, "file not exist");
        removeTree(fileid);
      }
      return ok();
    },
    file_upload: (body) => {
      if (!parentExists(body.spaceid, body.fatherid)) return err(640002, "father not exist");
      const bytes = decodeBase64(body.file_base64_content);
      if (bytes.length > DIRECT_LIMIT) return err(640047, "file too large");
      // 直传没有 skip_push_card：按「会推卡片」处理
      cards.push(body.file_name);
      return ok({
        fileid: addNode(body.spaceid, body.fatherid, body.file_name, 2, bytes.length, sha1Of(bytes))
      });
    },
    file_upload_init: (body) => {
      if (!parentExists(body.spaceid, body.fatherid)) return err(640002, "father not exist");
      const size = Number(body.size);
      const blocks = Math.ceil(size / BLOCK);
      if (!(size > 0) || !Array.isArray(body.block_sha) || body.block_sha.length !== blocks) {
        return err(640039, "size and block_sha not match");
      }
      const fileSha = body.block_sha[blocks - 1];
      if (instantShas.has(fileSha)) {
        if (!body.skip_push_card) cards.push(body.file_name);
        return ok({
          hit_exist: true,
          fileid: addNode(body.spaceid, body.fatherid, body.file_name, 2, size, fileSha)
        });
      }
      const uploadKey = nextId("upload");
      uploads.set(uploadKey, {
        spaceid: body.spaceid,
        fatherid: body.fatherid,
        file_name: body.file_name,
        size,
        block_sha: [...body.block_sha],
        skip: Boolean(body.skip_push_card),
        sha: createSha1Stream(),
        received: 0,
        nextIndex: 1
      });
      return ok({ hit_exist: false, upload_key: uploadKey });
    },
    file_upload_part: (body) => {
      const upload = uploads.get(body.upload_key);
      if (!upload) return err(640048, "upload flow error");
      // 这个假微盘只接受按顺序来的分片（我们的客户端就是按顺序传的）
      if (body.index !== upload.nextIndex) return err(640048, "unexpected part index");
      const bytes = decodeBase64(body.file_base64_content);
      const last = upload.nextIndex === upload.block_sha.length;
      const expected = last ? upload.size - upload.received : BLOCK;
      if (bytes.length !== expected) return err(640039, "part size not match");
      upload.sha.update(bytes);
      const claimed = upload.block_sha[upload.nextIndex - 1];
      // 真实规则：中间块是到这块末尾为止的内部状态（小端），最后一块是整文件 SHA1
      const actual = last ? upload.sha.digestHex() : upload.sha.stateHex("little");
      if (claimed !== actual) return err(640049, "upload sha not match");
      upload.received += bytes.length;
      upload.nextIndex += 1;
      return ok();
    },
    file_upload_finish: (body) => {
      const upload = uploads.get(body.upload_key);
      if (!upload) return err(640048, "upload flow error: finish called twice");
      if (upload.received !== upload.size) return err(640048, "upload not complete");
      uploads.delete(body.upload_key);
      if (!upload.skip) cards.push(upload.file_name);
      return ok({
        fileid: addNode(
          upload.spaceid,
          upload.fatherid,
          upload.file_name,
          2,
          upload.size,
          upload.sha.digestHex()
        )
      });
    }
  };

  const call = async (apiName, body) => {
    const logged = { ...body };
    if (typeof logged.file_base64_content === "string") {
      logged.file_base64_content = `<${logged.file_base64_content.length} chars>`;
    }
    calls.push({ api: apiName, body: logged });
    const failure = failures.find((item) => item.api === apiName);
    if (failure) {
      failure.times -= 1;
      failures = failures.filter((item) => item.times > 0);
      if (failure.errcode === "timeout") throw new Error("bridge proxy timeout");
      if (failure.errcode === "lost") {
        // 请求到了、微盘也照做了，只是答复没回来
        handlers[apiName]?.(body);
        throw new Error("bridge proxy timeout");
      }
      // 企微的原话里每次请求都带一个不一样的 hint
      hintSeq += 1;
      return err(
        failure.errcode,
        `fake failure ${failure.errcode}, hint: [17${hintSeq}_fake], from ip: 203.0.113.9`
      );
    }
    const handler = handlers[apiName];
    if (!handler) return err(40058, `unknown api ${apiName}`);
    return handler(body);
  };

  /** 目录树：{ 目录名: { 子目录名: {...}, 文件名: 大小 } }；不给 spaceid 就取第一个空间 */
  const tree = (spaceid = [...spaces.keys()][0]) => {
    const build = (fatherid) =>
      Object.fromEntries(
        siblings(spaceid, fatherid)
          .sort((a, b) => (a.file_name < b.file_name ? -1 : 1))
          .map((node) => [
            node.file_name,
            node.file_type === 1 ? build(node.fileid) : node.file_size
          ])
      );
    return spaceid ? build(spaceid) : {};
  };

  return {
    call,
    calls,
    cards,
    spaces,
    nodes,
    tree,
    instantShas,
    /**
     * 接下来 times 次调这个接口：回这个错误码。errcode 给 "timeout" 就抛出（请求没到）；
     * 给 "lost" 是请求到了、微盘照做了，但答复丢了（也是抛出）。
     */
    failNext: (api, errcode, times = 1) => {
      failures = [...failures, { api, errcode, times }];
    },
    /** 直接往假微盘里放一个文件（模拟「上次传成了但没记下来」） */
    putFile: (spaceid, fatherid, name, size) => addNode(spaceid, fatherid, name, 2, size, null),
    callsTo: (api) => calls.filter((item) => item.api === api)
  };
};
