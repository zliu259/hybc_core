/** 把「选文件夹」和「拖文件夹进来」两种来源读成同一种东西：文件加它在文件夹里的相对路径。 */

export interface PickedFile {
  /** 相对路径，如 资料/老三号/合格证.pdf */
  path: string;
  file: File;
}

/** 浏览器 FileSystemEntry 里用到的那几样 */
export interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (
    resolve: (file: File) => void,
    reject: (error: unknown) => void
  ) => void;
  createReader?: () => {
    readEntries: (
      resolve: (entries: EntryLike[]) => void,
      reject: (error: unknown) => void
    ) => void;
  };
}

/** <input webkitdirectory> 选出来的文件。 */
export const fromInputFiles = (files: ArrayLike<File>): PickedFile[] =>
  Array.from(files).map(file => ({
    path: file.webkitRelativePath || file.name,
    file
  }));

type EntryReader = NonNullable<
  ReturnType<NonNullable<EntryLike["createReader"]>>
>;

/** readEntries 一次最多给 100 个，要一直读到给出空的为止。 */
const readAll = async (reader: EntryReader): Promise<EntryLike[]> => {
  const batch = await new Promise<EntryLike[]>((resolve, reject) =>
    reader.readEntries(resolve, reject)
  );
  return batch.length === 0 ? [] : [...batch, ...(await readAll(reader))];
};

const walk = async (
  entry: EntryLike,
  prefix: string
): Promise<PickedFile[]> => {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  try {
    if (entry.isFile && entry.file) {
      const read = entry.file.bind(entry);
      const file = await new Promise<File>((resolve, reject) =>
        read(resolve, reject)
      );
      return [{ path, file }];
    }
    if (entry.isDirectory && entry.createReader) {
      const children = await readAll(entry.createReader());
      const nested = await Promise.all(
        children.map(child => walk(child, path))
      );
      return nested.flat();
    }
  } catch (error) {
    // 个别文件读不了（被占用、没权限）不该让整个文件夹导不进来
    console.warn("[doc-library] 读不了这个文件，已跳过", path, error);
  }
  return [];
};

/** 拖进来的文件夹（或文件）：递归读出里面所有文件。 */
export const readDroppedEntries = async (
  entries: readonly EntryLike[]
): Promise<PickedFile[]> =>
  (await Promise.all(entries.map(entry => walk(entry, "")))).flat();

/** 从拖放事件里取出条目。必须在 drop 事件处理函数里同步调用，过后浏览器就不给了。 */
export const entriesFromDrop = (transfer: DataTransfer | null): EntryLike[] =>
  Array.from(transfer?.items ?? [])
    .map(item =>
      item.kind === "file" && typeof item.webkitGetAsEntry === "function"
        ? (item.webkitGetAsEntry() as EntryLike | null)
        : null
    )
    .filter((entry): entry is EntryLike => entry !== null);
