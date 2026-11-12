import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/**
 * pdf.js 的字符映射表（cMap）在网页里的位置，开发和线上一样。
 * 放在 static/ 下面：线上这个目录缺文件时回的是真的 404（functions/static），不会把首页当成映射表。
 */
export const PDFJS_CMAP_DIR = "static/pdfjs/cmaps/";

const CMAP_NAME = /^[\w.-]+\.bcmap$/;

const cmapSourceDir = (): string => {
  const entry = createRequire(import.meta.url).resolve("pdfjs-dist");
  const marker = `${path.sep}pdfjs-dist${path.sep}`;
  const root = entry.slice(0, entry.lastIndexOf(marker) + marker.length);
  return path.join(root, "cmaps");
};

/**
 * 把 pdfjs-dist 自带的字符映射表跟着网页一起发。
 * 没内嵌中文字体的 PDF（不少电子证照是这样）要靠它才画得出字，不带的话中文是空白。
 * pdf.js 按原名去取，所以不能走带 hash 的资源管线：开发时直接从 node_modules 给，打包时原名放进产物。
 */
export function pdfjsCmaps(): Plugin {
  const source = cmapSourceDir();
  return {
    name: "hybc:pdfjs-cmaps",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const index = url.indexOf(`/${PDFJS_CMAP_DIR}`);
        if (index < 0) {
          next();
          return;
        }
        const name = path.basename(
          url.slice(index + PDFJS_CMAP_DIR.length + 1)
        );
        const file = path.join(source, name);
        if (!CMAP_NAME.test(name) || !fs.existsSync(file)) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }
        res.setHeader("content-type", "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const name of fs.readdirSync(source)) {
        if (!CMAP_NAME.test(name)) continue;
        this.emitFile({
          type: "asset",
          fileName: `${PDFJS_CMAP_DIR}${name}`,
          source: fs.readFileSync(path.join(source, name))
        });
      }
    }
  };
}
