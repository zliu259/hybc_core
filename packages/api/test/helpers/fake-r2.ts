/**
 * 测试用的 R2 桶：内存里的最小实现，行为照 R2 的来（分片上传的校验规则也是）。
 * 用法：const files = createFakeR2(); env.FILES = files as unknown as R2Bucket; files.objects 可直接断言。
 */
export interface FakeR2Object {
  body: Uint8Array;
  contentType: string;
}

interface FakeUpload {
  key: string;
  contentType: string;
  parts: Map<number, { etag: string; body: Uint8Array }>;
  aborted: boolean;
}

interface RangeOption {
  offset?: number;
  length?: number;
  suffix?: number;
}

const MIN_PART_SIZE = 5 * 1024 * 1024;

const toBytes = async (value: unknown): Promise<Uint8Array> => {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (typeof value === "string") return new TextEncoder().encode(value);
  return new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
};

export const createFakeR2 = () => {
  const objects = new Map<string, FakeR2Object>();
  const uploads = new Map<string, FakeUpload>();
  let sequence = 0;

  const describe = (key: string, object: FakeR2Object) => ({
    key,
    size: object.body.length,
    etag: `etag-${key}-${object.body.length}`,
    httpEtag: `"etag-${key}-${object.body.length}"`,
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", object.contentType);
    }
  });

  const handle = (key: string, uploadId: string) => ({
    key,
    uploadId,
    async uploadPart(partNumber: number, value: unknown) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.aborted || upload.key !== key) throw new Error("NoSuchUpload");
      const body = await toBytes(value);
      sequence += 1;
      const etag = `etag-${uploadId}-${partNumber}-${sequence}`;
      upload.parts.set(partNumber, { etag, body });
      return { partNumber, etag };
    },
    async complete(parts: { partNumber: number; etag: string }[]) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.aborted || upload.key !== key) throw new Error("NoSuchUpload");
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const bodies = ordered.map((part, index) => {
        const stored = upload.parts.get(part.partNumber);
        if (part.partNumber !== index + 1 || !stored || stored.etag !== part.etag) {
          throw new Error("InvalidPart");
        }
        return stored.body;
      });
      if (bodies.length === 0) throw new Error("InvalidPart");
      bodies.slice(0, -1).forEach((body) => {
        if (body.length < MIN_PART_SIZE || body.length !== bodies[0].length) {
          throw new Error("EntityTooSmall or parts of different sizes");
        }
      });
      const total = bodies.reduce((sum, body) => sum + body.length, 0);
      const merged = new Uint8Array(total);
      bodies.reduce((offset, body) => {
        merged.set(body, offset);
        return offset + body.length;
      }, 0);
      const object = { body: merged, contentType: upload.contentType };
      objects.set(key, object);
      uploads.delete(uploadId);
      return describe(key, object);
    },
    async abort() {
      const upload = uploads.get(uploadId);
      if (upload) upload.aborted = true;
    }
  });

  return {
    objects,
    uploads,
    async put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }) {
      const object = {
        body: await toBytes(value),
        contentType: options?.httpMetadata?.contentType ?? "application/octet-stream"
      };
      objects.set(key, object);
      return describe(key, object);
    },
    async get(key: string, options?: { range?: RangeOption }) {
      const object = objects.get(key);
      if (!object) return null;
      const range = options?.range;
      const size = object.body.length;
      const offset = range?.suffix !== undefined ? size - range.suffix : (range?.offset ?? 0);
      const length = range?.suffix ?? range?.length ?? size - offset;
      const slice = object.body.slice(offset, offset + length);
      return {
        ...describe(key, object),
        range: range ? { offset, length: slice.length } : undefined,
        body: new Response(slice).body,
        arrayBuffer: async () =>
          slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length)
      };
    },
    async head(key: string) {
      const object = objects.get(key);
      return object ? describe(key, object) : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async createMultipartUpload(
      key: string,
      options?: { httpMetadata?: { contentType?: string } }
    ) {
      sequence += 1;
      const uploadId = `upload-${sequence}`;
      uploads.set(uploadId, {
        key,
        contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
        parts: new Map(),
        aborted: false
      });
      return handle(key, uploadId);
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      return handle(key, uploadId);
    }
  };
};

export type FakeR2 = ReturnType<typeof createFakeR2>;
