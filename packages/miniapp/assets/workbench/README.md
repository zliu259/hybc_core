# 工作台入口图标

文件名是 `utils/workbench-view.js` 里入口的 `key`，页面按这个规则取图，测试会检查文件存在。

- 来源：[Lucide](https://lucide.dev)（ISC 许可，保留下面的声明）。
- 规格：96×96 PNG，透明底，白色线条，线宽 2。底色在 `pages/index/index.wxss` 里按类别设置。

| key | Lucide 图标 |
| --- | --- |
| dashboard | gauge |
| projects | building-2 |
| managerLog | notebook-pen |
| operatorLog | hard-hat |
| progress | chart-line |
| asset | scan-line |
| survey | shield-check |
| paymentApply | badge-japanese-yen |
| reimbursement | receipt-text |
| fuel | fuel |
| maintenance | car |
| vehicleRecords | clipboard-list |
| archive | mail-check |
| query | search |
| contractPrecheck | file-check-2 |
| initiated | file-text |
| approvalRecords | history |
| projectCreate | folder-plus |

新增图标：从仓库依赖 `@iconify/json` 的 `json/lucide.json` 取 `icons[名字].body`，包成
`<svg viewBox="0 0 24 24">`，把 `currentColor` 换成 `#ffffff`，用 `sharp` 输出 96×96 PNG。

## Lucide 许可声明

ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without
fee is hereby granted, provided that the above copyright notice and this permission notice appear
in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS
SOFTWARE.
