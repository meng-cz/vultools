# VUL Tools

VUL Tools 是面向 VUL 硬件开发与建模语言的 VS Code 扩展。

- 名称：**VUL Tools**
- 扩展标识：**mengcz-sdu.vul-tools**
- 当前版本：**0.1.0**

## 使用

打开 `.vul` 硬件模块、`.uh` Header 或 `.utb` 测试入口时，默认进入 VUL Tools 可视化视图。通过 **Source View** 切换到源码后，可点击编辑器右上角的预览按钮，或执行 **VUL Tools: Open Visual View** 返回可视化。可视化视图按类别展示组件，点选后查看 API 参数、默认值、业务参数和原始 C++ 代码块。接口和实现版本保留各自层级；接口声明可以查看关联的实现代码。

点击 **Source View** 返回源码编辑器。结构和属性只读；实现代码使用可临时编辑的代码框，去掉外层花括号和公共缩进，并采用 VS Code 的编辑器字体、字号、字重、行高与 Tab 宽度。代码框中的修改只保留在当前视图，切换组件后仍保留，刷新后恢复源码内容，不写回文件。进入可视化、保存文件或执行 **VUL Tools: Refresh Declarations** 时，使用当前文档内容重新解析，包括未保存内容。其他源码编辑会将现有展示标为过期。

列表中的 ALIAS 直接显示目标类型，例如 `Word → uint32_t`、`Lane → uint32_t[8][WIDTH]`；REGISTER、QUEUE、BRAM、WIRE 和流水线数据端点显示为 `name<type>`，如 `bank<uint32_t[4]>`；QUERY 显示为 `name → type`。名称与类型整体加粗，右侧 API 参数表保留原始 type、dims 属性。

PARAMETER 在列表中显示为 `NAME = 默认值表达式`。REQUEST / SERVICE 使用加粗函数签名，例如 `fetch(uint32_t data, uint64_t & resp) -> bool`，握手开启时才显示 bool 返回值（包括 SERVICE 的 ready 隐含握手）。列表摘要只展示剩余的显式参数，例如 ready、dims、priority，不重复展示业务参数和 handshake。所有列表项均隐藏自动填充的默认参数；右侧详情保留默认值。宏名和名称加粗，其余参数保持相同字号、颜色及普通字重。

临时代码框支持 C++ TextMate 语法高亮，优先采用已安装 C++ 提供者的语法定义，默认使用 VS Code 内置 C++ 语法；配色来自当前可访问的主题及 `editor.tokenColorCustomizations`（包含主题专用配置）。主题或配色变化后会重新着色，临时修改保留。Remote - SSH 下若远端无法读取仅安装在本地的主题，则采用对应明暗类型的默认主题。此处提供词法高亮，不调用 C++ IntelliSense 或进行语义检查。

`.vul`、`.uh` 和 `.utb` 均支持源码/可视化切换、属性与代码查看、未保存刷新及声明诊断。`.utb` 使用测试入口解析规则，显示 **Global Declarations** 和 **Testbench Contents**；`.uh` 使用 Header 解析规则，仅显示当前文件的 **Header Contents**，不重复展示项目全局栏。三种扩展名默认打开可视化；不新增 Header 语言关联。如果此前显式配置过 `workbench.editorAssociations`，该用户设置仍优先，可通过 **Reopen Editor With... → Configure Default Editor** 选择 VUL Tools Visual View。

Problems 中的 **VUL Tools** 诊断检查 API 参数、声明边界与作用域。可在设置 `vulTools.diagnostics.enabled` 中关闭。源码中的 C++ 行为代码不进行语法或类型检查，表达式不求值，跨模块兼容性与可综合性由现有 VUL 工具链判定。

自定义宏不展开；条件编译不执行，条件区域中的声明在视图中标记为未求值。不提供源码跳转、图形编辑、属性写回、专属补全或项目索引。

## 项目级全局声明

`.vul` 左侧一级栏采用统一的展开与分栏策略，顺序如下：

1. **INTERFACE**：有接口块时置于最上方，直接列出其中参数和事务声明，不重复显示接口块或 Interfaces 分类标题。
2. **Global Declarations**：项目 Header 中的 CONFIG、ALIAS、STRUCT、ENUM、HELPER。
3. **Module Contents**：版本和接口之外的本文件声明；没有 VERSION 时标题改为 **Default Version**。
4. **VERSION 名称**：按源码顺序列出各版本。USE_VERSION 不生成列表条目，只通过 VERSION 标题的 `✓ selected` 标识反映选择。

首次打开 `.vul` 时，INTERFACE、本地内容和选中的 VERSION 默认展开，全局声明及其他版本默认收起；可同时展开多个版本，用户保存的展开状态优先。点击 VERSION 标题还可查看版本属性，接口条目仍可查看关联版本的实现代码。`.utb` 使用 **Testbench Contents**，`.uh` 仅显示当前 **Header Contents**。

所有一级栏保持原始顺序。收起栏仅保留标题，展开栏独立滚动；只有一个栏展开时填满扣除其他标题后的高度，全部收起时标题依次置顶。多个栏展开时，在每对相邻展开栏之间显示一条可拖动分界线；若中间夹着收起栏，分界线放在这组收起标题上方，拖动仅调整最近的上下展开栏，收起标题保持固定高度。

没有历史高度数据时，INTERFACE 初始高度按内容自然总高度（含标题与内边距）计算，最多占左侧总高度的 35%；超过上限时内部滚动，剩余空间分配给其他展开栏。此规则只用于初始自适应，不限制之后的手动拖动；已有高度权重优先恢复。未调整时，展开的全局声明占剩余可分配内容高度的 30%，其余展开栏均分剩余 70%；全局声明收起时，其余展开栏均分。调整后的权重随视图保存，折叠不清除，重新展开时恢复参与分配。双击分界线恢复相邻栏默认比例；聚焦后可用方向键、Page Up / Page Down、Home / End 调整。窗口高度不足时，左侧整体滚动，保证所有标题可访问。

每个展开的一级栏都具有独立的纵向滚动区域：内容溢出时显示主题滚动条，预留固定滚动条位置；鼠标悬停在内容上使用滚轮或拖动滑块，仅滚动当前栏，一级标题保持固定。滚动到顶部或底部不会连带其他栏和右侧详情；左侧整体因高度不足而溢出时，仍可在标题区域或外层滚动条操作。收起的栏不显示内容区滚动条。

一级栏内容保持右缩进和对比色竖线。详情显示声明来源文件、API 参数和代码；全局常量 CONFIG 在列表中显示 `NAME = value`。

项目目录按以下顺序识别：

1. 设置 `vulTools.projectRoot`：绝对路径直接使用，相对路径以当前文件所属工作区目录为基准。可在多根工作区的各文件夹中分别配置。
2. 当前模块顶层的 `PROJECT("../project");` 或 `PROJECT(path="../project");`：相对路径以模块所在目录为基准，至多一个，要求普通双引号字符串字面量。它是扩展的项目绑定信息，不修改 SDK 的处理规则，也不参与 INTERFACE / USE_VERSION 的排列检查。
3. 从模块目录向上查找最近包含 `header/` 或 `header.uh` 的目录，直到文件系统根目录。

显式设置或 PROJECT 无效时显示错误，不回退到其他目录；未找到项目时仍可浏览模块。单文件 Header 直接分类展示；`header/` 递归收集 `.uh`，按相对路径排序并分文件展示，递归时不跟随符号链接。两种 Header 形式互斥，冲突时提示修正，不任意选择。

Header 已打开时优先读取未保存内容。编辑 Header 后全局结果标为过期，保存、重新进入可视化或手动刷新后更新；外部变更和文件增删会合并刷新。同一项目的模块共享 Header 缓存，普通模块编辑不会使全局声明过期。Header 声明错误发布到对应文件的 Problems，受 `vulTools.diagnostics.enabled` 控制；Header 默认打开可视化，可通过 Source View 切换到源码。全局与模块代码框的临时编辑相互隔离，刷新全局不会清除模块代码草稿。

本功能收集 VUL 声明，不计算参数或类型、不执行预处理，也不按 include 关系做依赖求值或跨文件语义检查。

## 开发与安装

开发基线：Ubuntu x86_64、Node.js 24、npm、VS Code 1.95 或更新版本。Remote - SSH 下扩展运行于工作区宿主。查看和声明解析不需要安装 LLVM、Clang 或 VUL SDK。

```bash
npm ci
npm run typecheck
npm test
npm run package
```

打包生成 `vul-tools-0.1.0.vsix`，在 VS Code 中通过 **Extensions: Install from VSIX...** 安装。按 F5 启动 Extension Development Host，默认打开 `install/example/querydemo`。构建先进行 TypeScript 编译，再用 esbuild 将宿主代码及运行时依赖打包为 CommonJS，同时生成 Oniguruma WASM 和第三方许可证。Webview 使用原生 HTML/CSS/JavaScript。

## 运行真实示例

直接使用 SDK 的 `install/example/` 下的 `querydemo`、`prodcon` 和 `array1d`。模块扩展名为 `.vul`、Main 为 `.utb`，Header 使用 `.uh`。安装包放在根目录 `install/`，或通过环境变量 `VUL_SDK` 指定目录；SDK 不进入 VSIX。

```bash
node scripts/build-example.cjs querydemo
node scripts/build-example.cjs prodcon
node scripts/build-example.cjs array1d
# 或指定 SDK 路径（含空格的路径请加引号）
node scripts/build-example.cjs querydemo /path/to/install
npm run test:examples
```

需要现有 `vulsimgen`、`vullib` 和支持 C++20 的 `g++`；可通过 `CXX` 指定编译器可执行文件。脚本显式传入 SDK、Main、Top、项目及输出目录；仅覆盖各样例 `build/simout/`。生成的仿真代码使用 C++ 编译器编译，此步骤与插件的声明检查相互独立。构建或运行失败时返回非零状态。为兼容 SDK 中残留的旧 `.hpp/.cpp`，脚本将 `.uh/.vul/.utb` 源文件复制到临时工程后调用生成器，完成或失败后自动清理，不修改 SDK 源文件。`npm run test:examples` 还会逐行核对三个案例的仿真输出。

构建脚本固定使用本仓库 `install/example/` 中的案例；SDK 参数或 `VUL_SDK` 只覆盖工具链位置。可从仓库根目录运行上面的命令，构建不依赖扩展，需要信任工作区。

## 测试

```bash
npm test                 # 解析器、文档快照、Webview DOM 与元数据
npm run test:examples    # 三个 SDK 案例，生成/编译/运行
npm run test:host        # VS Code 1.95.3 扩展宿主测试，首次下载测试宿主
npm run test:webview     # 真实 Webview 滚轮、滑块拖动及边界检查；驱动需 Node.js 22+
```

Linux 无桌面环境时使用 `xvfb-run -a npm run test:host` 或 `xvfb-run -a npm run test:webview`。可设置 `VSCODE_TEST_VERSION` 或 `VSCODE_TEST_EXECUTABLE` 指定测试宿主。宿主测试覆盖文件关联、视图切换、未保存刷新、诊断和保存行为；DOM 测试覆盖组件点选、只读属性、临时代码编辑、版本关联、过期结果及安全文本渲染。

声明检查基于 SDK 随附的声明 API 手册，支持表和边界见 [声明解析说明](docs/declarations.md)。发布验收见 [验收记录](docs/acceptance.md)。

`test:webview` 使用隔离的临时工程和 VS Code 用户目录，通过仅本地的临时 DevTools 端口发送 Chromium 原生鼠标输入，验证实际 Webview；不向扩展添加测试专用消息。它覆盖长/短列表、VERSION 滚轮与滚动条拖动、标题固定、滚动边界、折叠恢复、视口尺寸更新和 `.uh/.utb` 文件。可设置 `VUL_WEBVIEW_SCREENSHOT` 为 PNG 路径，保留拖动检查前的工作台截图。
