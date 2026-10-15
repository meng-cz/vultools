# VUL Tools 项目文件索引

本索引供 AI 开发时快速定位职责、调用关系与修改入口，以当前实现为准。项目是 VS Code 扩展，名称为 **VUL Tools**，扩展标识为 `mengcz-sdu.vul-tools`。硬件模块绑定 `.vul`，测试入口绑定 `.utb`；Header 保持 `.h/.hpp` 的现有语言关联。

主要数据流：`src/extension.ts` → `src/session.ts` → `src/parser/index.ts` → `lexer.ts` / `rules.ts` → `ParseResult` → Problems 与 Webview。Webview 通过 `ready`、`refresh`、`source` 消息请求宿主动作，宿主通过 `snapshot` 消息发布文档状态和解析结果。

实现边界：只检查 VUL 声明；内嵌 C++ 代码原样提取，不做 C++ 语法或类型检查；不执行预处理、表达式求值或跨模块分析。可视化只读，不写回源码。源码范围使用 UTF-16 偏移，快照绑定文档版本。

索引涵盖源码、工程配置、开发脚本、测试和当前维护文档。外部 SDK、示例目录、依赖、生成文件、安装包、缓存、Git 内部元数据及历史规划文档不逐文件列出。新增、删除或调整文件职责时同步维护本索引。

## `src/extension.ts`

- **职责**：扩展宿主入口，导出 `activate()` 和 `viewType`，注册命令、自定义文本编辑器、文档事件、诊断集合与输出通道。
- **关键逻辑**：`session()` 按 URI 管理文档状态；`refresh()` 解析当前文档；`publish()` 转换 Problems 诊断；`notify()` 发布 Webview 快照；`currentDocument()` 兼容源码与自定义编辑器。
- **交互**：处理 `vul-tools.openVisual`、`vul-tools.openSource`、`vul-tools.refresh`；生成 Webview HTML、CSP 和本地资源 URI。HTML 元素 ID 与 `media/visualizer.js` 对应。
- **更新策略**：编辑立即使展示过期并清理旧诊断，300 ms 后检查声明；存在可视化面板时只更新诊断，保留旧快照直到进入视图、保存或显式刷新。关闭文档和扩展时清理状态与定时器。
- **修改入口**：命令、生命周期、刷新策略、Problems、Webview 消息。与 `package.json`、`src/session.ts`、`media/visualizer.js` 联动；返回的 `getSnapshot()` 供宿主回归测试读取。

## `src/session.ts`

- **职责**：`DocumentSession` 保存 `version`、`result`、`stale`，隔离文档快照状态。
- **接口**：`invalidate(version)` 标记过期；`refresh(text, version, kind)` 同步调用解析器并提交新快照。
- **修改入口**：版本绑定、过期状态和缓存行为；调用方为扩展入口，回归覆盖在解析器测试中。

## `src/parser/model.ts`

- **职责**：定义宿主、解析器与 Webview 共享的数据形状。
- **关键类型**：`FileKind`、`Span`、`Issue`、`Attribute`、`BusinessParameter`、`Component`、`ParseResult`；`flatten()` 递归展开组件树。
- **约定**：`attributes` 区分显式值和默认值；`parameters` 保存 ARG/RESP；`overrides` 保存子模块参数覆盖；`codeBlocks` 保存原文及范围；`children`、`condition`、`selected`、`relatedIds` 表示嵌套、条件、版本和声明关联。
- **修改入口**：新增数据字段时同步检查解析器、宿主消息和浏览器端消费代码；浏览器脚本没有 TypeScript 类型约束。

## `src/parser/rules.ts`

- **职责**：声明 API 的规则表，定义 `Rule`、`rules` 以及端点、Header、测试入口允许的声明集合。
- **规则字段**：`fields` 为位置参数顺序，`defaults` / `optional` 表示默认或可选属性，`tail` 描述业务参数、参数覆盖或流水线端点，`body` 描述代码块形式，`category` 指定展示分类。
- **修改入口**：增加 API、调整参数或默认值、分类。复杂合法性与作用域检查仍在 `src/parser/index.ts`；高亮关键字需同步到 TextMate 语法文件。

## `src/parser/lexer.ts`

- **职责**：`tokenize(source)` 产生带原始范围的 `Token[]` 和词法问题，供声明解析器使用。
- **处理内容**：标识符、数字、符号、普通字符串、字符字面量、带自定义分隔符的原始字符串、预处理指令及续行；注释和空白不进入 Token 列表。
- **边界**：只保留预处理指令，不展开宏或计算条件；通过原文范围保留代码块内容。
- **修改入口**：注释、转义、字符串、数字和词法边界问题。

## `src/parser/index.ts`

- **职责**：纯解析入口 `parse(source, fileKind = 'module'): ParseResult`，并重新导出模型；内部 `Parser` 负责声明解析、检查、恢复和关联。
- **关键流程**：`region()` 扫描作用域及条件标签；`declaration()` 解析一条声明和代码块；`arguments()` 处理属性、默认值、业务参数、参数覆盖与流水线端点。
- **边界处理**：`matching()` 定位括号边界，C++ 块只匹配花括号；`split()` 按上下文切分参数，避免模板逗号、表达式比较/移位及复位块内容干扰切分。
- **检查与关联**：`allowed()` 检查作用域，`singleDimensionList()` 检查维度列表边界；`relationships()` 处理重复声明、接口与版本关系；`link()` 关联 SERVICE/QUERY 并比较可直接检查的签名。
- **连接显示**：`connectionFields` 定义四种 CONNECT 的源、目标字段；按字段名组合 `实例.端口 → 实例.端口` 或模块边界端口，不依赖命名参数的填写顺序。
- **修改入口**：声明语法、参数约束、错误恢复、条件区域处理、声明与实现关联。依赖仅为模型、词法器和规则表，不依赖 VS Code 或 SDK。

## `media/visualizer.js`

- **职责**：Webview 浏览器端逻辑，接收 `snapshot`，按分类和容器层级渲染组件，并处理组件点选。
- **关键函数**：`list()` 渲染组件树；`detail()` 展示属性、签名、关联实现、代码块和诊断；`attributes()` 构造参数表；`element()` 使用 `textContent` 创建文本节点。
- **接口列表**：模块的 INTERFACE 内容直接列在顶部唯一的 Interfaces 标题下，容器本身不可点选；对应实现按 Implementations 分类，版本层级保留。
- **状态与协议**：使用 Webview state 保存所选组件 ID；按文档版本过滤旧消息；显示未保存、过期及错误状态。仅向宿主发送 `ready`、`refresh`、`source`，不发送源码修改。
- **修改入口**：详情内容、分类导航、组件选择和展示状态；结构改动需同步宿主 HTML、CSS 和 DOM 测试。源代码不能直接拼接成 HTML。

## `media/visualizer.css`

- **职责**：可视化页面布局、组件选中态、参数表、代码块、错误和过期提示样式。
- **约定**：使用 VS Code 主题变量；主区域采用两列 Grid，窄屏切换为单列；保留按钮键盘焦点样式。
- **修改入口**：布局、主题适配、可读性和响应式行为，与宿主 HTML 和浏览器端生成的 class / ID 对齐。

## `syntaxes/vul.tmLanguage.json`

- **职责**：`.vul` 的 TextMate 高亮规则，scope 为 `source.vul`。
- **规则顺序**：原始字符串、注释、普通字符串、VUL 声明关键字、命名属性，再包含 `source.cpp` 处理其余 C++ 高亮。
- **修改入口**：新增声明或属性的着色、字符串与注释匹配。高亮规则独立于声明解析器，不承担合法性检查。

## `syntaxes/vul-testbench.tmLanguage.json`

- **职责**：`.utb` 的 TextMate 入口，scope 为 `source.vul.testbench`，通过包含 `source.vul` 复用高亮。
- **修改入口**：测试入口需要独立高亮行为时在此扩展；语言和 grammar 绑定见 `package.json`。

## `language-configuration.json`

- **职责**：`.vul` / `.utb` 编辑器的注释命令、括号配对、自动闭合和包围规则。
- **修改入口**：源码输入体验；此文件不控制解析、诊断或语义高亮。

## `package.json`

- **职责**：VS Code 扩展清单及 npm 工程入口；固定 `name=vul-tools`、`displayName=VUL Tools`、`publisher=mengcz-sdu`。
- **扩展贡献**：文件关联、grammar、自定义编辑器、命令、标题栏菜单及 `vulTools.diagnostics.enabled` 配置。自定义编辑器为可选项，默认仍打开源码。
- **运行约定**：入口 `out/extension.js`，`extensionKind=workspace`；声明最低 VS Code 版本及工作区能力。生产代码仅依赖 VS Code 和 Node 内置模块。
- **脚本入口**：`build`、`typecheck`、`test`、`test:host`、`test:examples`、`package`、`example`；VSIX 打包使用 `--no-dependencies`。
- **修改入口**：元数据、功能注册、配置和构建命令。命令前缀保持 `vul-tools.*`，配置前缀保持 `vulTools.*`。

## `package-lock.json`

- **职责**：固定 npm 开发依赖及其传递依赖，支持通过 `npm ci` 复现开发环境。
- **维护方式**：使用 npm 更新，依赖调整与 `package.json` 同步；不手工维护生成的依赖条目。

## `tsconfig.json`

- **职责**：编译 `src/**/*.ts` 到 `out/`，目标为 ES2022 / CommonJS，启用 strict 和 source map。
- **修改入口**：编译目标、模块格式、类型检查与源码布局；入口或输出目录调整需同步扩展清单、调试配置和测试导入路径。

## `scripts/build-example.cjs`

- **职责**：开发用真实仿真构建脚本，导出 `buildExample(name, sdkArg)`，也可从命令行运行。
- **流程**：检查案例与 SDK → 调用 `vulsimgen` → 用 C++20 编译生成代码 → 执行仿真；所有子进程使用参数数组和 `shell: false`，非零退出码作为失败。
- **配置**：SDK 按显式参数、`VUL_SDK`、仓库本地安装目录依次选择；编译器使用 `CXX` 或 `g++`；输出固定到案例构建目录。
- **修改入口**：工具链调用、案例入口映射、构建与运行参数。扩展运行时不调用此脚本。

## `scripts/test-examples.cjs`

- **职责**：依次调用 `buildExample()`，执行三个真实案例的生成、编译和断言运行，失败时设置非零退出状态。
- **入口**：`npm run test:examples`；需要外部 SDK 和 C++20 编译器，与纯解析测试分开执行。

## `scripts/test-host.cjs`

- **职责**：通过 `@vscode/test-electron` 下载或选择 VS Code，并启动真实扩展宿主测试。
- **配置**：默认 VS Code 1.95.3；支持 `VSCODE_TEST_VERSION`、`VSCODE_TEST_EXECUTABLE` 和 `VSCODE_HEADLESS`。清除继承的 `ELECTRON_RUN_AS_NODE`，避免误以 Node 模式启动编辑器。
- **关联**：测试入口为 `tests/host/index.cjs`；Linux 无桌面环境可使用 Xvfb。首次执行可能需要联网下载宿主。

## `tests/parser.test.cjs`

- **职责**：使用 Node test runner 检查纯解析器与 `DocumentSession`，从 `out/` 导入编译结果。
- **覆盖**：参数与默认值、模板和表达式边界、业务参数、参数覆盖、接口与版本、流水线、作用域错误、错误恢复、条件标签、注释和字符串、UTF-16 / CRLF，以及快照过期行为。
- **依赖边界**：还读取本地迁移案例作真实源码回归；这些案例当前被 Git 忽略，运行相关测试前需确保其存在。此套测试不调用 SDK 二进制。
- **修改入口**：修改词法器、规则、解析算法或快照模型后，为相应行为添加回归用例。

## `tests/webview.test.cjs`

- **职责**：通过 jsdom 执行真实 `media/visualizer.js`，模拟 `acquireVsCodeApi()` 和宿主快照消息。
- **覆盖**：组件点选、默认属性、原始代码及安全文本渲染、只读交互、关联版本代码、过期消息、空结果和错误展示；同时检查扩展元数据、文件关联及命名空间。
- **修改入口**：Webview 结构、消息协议、详情展示或清单贡献变更时更新断言。

## `tests/host/index.cjs`

- **职责**：导出 `run()`，由实际 VS Code 扩展测试宿主加载；`until()` 等待异步状态。
- **覆盖**：扩展激活、真实 `.vul` / `.utb` 关联、Header 保持 C++ 关联、打开可视化、返回源码、未保存刷新不写回、诊断更新、保存和快照版本。
- **隔离**：在临时目录构造测试文件，结束时关闭并清理测试文档；通过扩展导出的 `getSnapshot()` 检查内部状态。
- **修改入口**：命令、编辑器生命周期、文档事件和文件关联的集成回归。

## `README.md`

- **职责**：面向使用者和开发者的主入口，说明安装、命令、视图行为、声明检查边界、开发构建、仿真脚本和测试方式。
- **维护时机**：用户操作、设置、环境要求或 npm 命令变化时同步更新。

## `docs/declarations.md`

- **职责**：描述已实现声明类别、检查能力、解析边界、模型范围、UTF-16 位置和 Webview 消息约束。
- **关联**：阅读声明规则或修改解析器前的背景材料；具体实现仍以 `src/parser/` 为准。

## `docs/acceptance.md`

- **职责**：记录发布验收环境、已执行的类型检查、自动化测试、仿真、宿主测试和打包结果，以及当前功能边界。
- **维护时机**：完成实际验证或发布新版本后更新；其中测试数量和版本是验收时记录，不是运行配置。

## `CHANGELOG.md`

- **职责**：按发布版本记录用户可见功能与变更。
- **维护时机**：功能发布时更新，并与 `package.json` 版本一致。

## `index.ai.md`

- **职责**：当前项目的逐文件开发导航，帮助 AI 决定先读哪个文件、改动会影响哪些调用方和测试。
- **维护方式**：根据实际文件与实现更新职责和关联；不把历史规划或验收记录中的描述当作当前代码的替代。
