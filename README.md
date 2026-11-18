# PGNode2Graph 静态版

用现代浏览器直接打开 `dist/index.html`。粘贴 PostgreSQL 调试日志或 GDB 的 `nodeToString()` 输出，点击「生成图形」进入大屏查看。也可以点击「载入示例」查看一棵查询树。

`dist/` 包含完整的静态站点和 Viz.js，可直接放到静态托管，也可以离线打开。解析在 JavaScript 中完成，Graphviz 通过 Viz.js 自带的 WebAssembly 在浏览器内渲染。

新图按 100% 从根节点开始显示。用 Ctrl + 滚轮围绕指针缩放，拖动平移，或按 Esc 返回编辑。「适应窗口」显示整图，「100%」恢复阅读字号并定位到根节点。返回编辑后可以点击「查看上次图形」继续查看。

手动生成的最近 12 条记录会保存在当前浏览器的 `localStorage`。如果浏览器限制本地文件访问存储，历史会暂存在当前页面。使用静态托管时，历史按浏览器和站点来源保存。

- `dist/node2dot.js` 解析 PostgreSQL 节点文本并生成 DOT
- `dist/app.js` 负责渲染、图形交互、导出和历史记录
- `dist/vendor/viz-global.js` 来自原项目中的 Viz.js 3.17.0
