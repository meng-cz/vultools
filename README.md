# VUL Tools

VUL Tools 是面向 VUL 硬件开发与建模语言的 VS Code 扩展。

- 名称：**VUL Tools**
- 扩展标识：**mengcz-sdu.vul-tools**
- 当前版本：**0.1.0**

## 使用

打开 `.vul` 硬件模块，点击编辑器右上角的预览按钮，或执行 **VUL Tools: Open Visual View**。可视化视图按类别展示组件，点选后查看 API 参数、默认值、业务参数和原始 C++ 代码块。接口和实现版本保留各自层级；接口声明可以查看关联的实现代码。

点击 **Source View** 返回源码编辑器。可视化为只读，不修改、保存或格式化源码。进入可视化、保存文件或执行 **VUL Tools: Refresh Declarations** 时，使用当前文档内容重新解析，包括未保存内容。其他编辑会将现有展示标为过期。

`.utb` 是测试 Main 文件，支持源码高亮和声明诊断。项目全局 Header 保持 `header.h` / `header.hpp` 或 `header/` 目录，不改变 C/C++ 编辑器关联。

Problems 中的 **VUL Tools** 诊断检查 API 参数、声明边界与作用域。可在设置 `vulTools.diagnostics.enabled` 中关闭。源码中的 C++ 行为代码不进行语法或类型检查，表达式不求值，跨模块兼容性与可综合性由现有 VUL 工具链判定。

自定义宏不展开；条件编译不执行，条件区域中的声明在视图中标记为未求值。不提供源码跳转、图形编辑、属性写回、专属补全或项目索引。

## 开发与安装

开发基线：Ubuntu x86_64、Node.js 24、npm、VS Code 1.95 或更新版本。Remote - SSH 下扩展运行于工作区宿主。查看和声明解析不需要安装 LLVM、Clang 或 VUL SDK。

```bash
npm ci
npm run typecheck
npm test
npm run package
```

打包生成 `vul-tools-0.1.0.vsix`，在 VS Code 中通过 **Extensions: Install from VSIX...** 安装。按 F5 启动 Extension Development Host，默认打开 `examples/querydemo`。当前项目通过 TypeScript 编译为 CommonJS，Webview 使用原生 HTML/CSS/JavaScript。

## 运行真实示例

仓库提供迁移后的 `querydemo`、`prodcon` 和 `array1d`。模块扩展名为 `.vul`、Main 为 `.utb`，Header 保留 `.hpp`。安装包放在根目录 `install/`，或通过环境变量 `VUL_SDK` 指定目录；SDK 不进入 VSIX。

```bash
node scripts/build-example.cjs querydemo
node scripts/build-example.cjs prodcon
node scripts/build-example.cjs array1d
# 或指定 SDK 路径（含空格的路径请加引号）
node scripts/build-example.cjs querydemo /path/to/install
npm run test:examples
```

需要现有 `vulsimgen`、`vullib` 和支持 C++20 的 `g++`；可通过 `CXX` 指定编译器可执行文件。脚本显式传入 SDK、Main、Top、项目及输出目录；仅覆盖各样例 `build/simout/`。生成的仿真代码使用 C++ 编译器编译，此步骤与插件的声明检查相互独立。每个示例内含断言，失败返回非零状态。

在 VS Code 单独打开一个示例目录，可执行 **VUL Tools: Build and Run** Task。Task 引用仓库内脚本，复制示例到其他位置时也需要保留脚本并调整 Task 路径。构建不依赖扩展或 npm 包，需要信任工作区。

## 测试

```bash
npm test                 # 解析器、文档快照、Webview DOM 与元数据
npm run test:examples    # 三个真实案例，生成/编译/运行断言
npm run test:host        # VS Code 1.95.3 扩展宿主测试，首次下载测试宿主
```

Linux 无桌面环境时使用 `xvfb-run -a npm run test:host`。可设置 `VSCODE_TEST_VERSION` 或 `VSCODE_TEST_EXECUTABLE` 指定测试宿主。宿主测试覆盖文件关联、视图切换、未保存刷新、诊断和保存行为；DOM 测试覆盖组件点选、只读属性与代码展示、版本关联、过期结果及安全文本渲染。

声明检查基于 SDK 随附的声明 API 手册，支持表和边界见 [声明解析说明](docs/declarations.md)。发布验收见 [验收记录](docs/acceptance.md)。
