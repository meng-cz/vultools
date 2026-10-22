# VUL Tools 0.1.0 验收记录

日期：2026-10-15。

## 环境

- Ubuntu 22.04 x86_64。
- Node.js 24.18.0，TypeScript 5.7.3；依赖由 package-lock.json 固定。
- VUL SDK：仓库本地 install；vulsimgen 版本输出为 `VulSim Simulation Generator V1.0`。
- 扩展标识：`mengcz-sdu.vul-tools`。

## 已验证

- `npm run typecheck`：通过。
- `npm test`：61 项通过，包含真实迁移源码解析、声明错误恢复、UTF-16/CRLF、接口与版本、流水线、文档快照、Webview 点选及安全文本展示、只读行为和元数据。
- `npm run test:examples`：querydemo、prodcon、array1d 均通过生成、C++20 编译和断言运行。querydemo 增加参数和模块局部别名后也单独复验通过。
- querydemo：4 次输出，值为 3、9、15、21。
- prodcon：20 周期内 10 次输出，按测试入口断言核对周期和累加值。
- array1d：4 个 lane，只收到一次输出 9。
- `npm run package`：可生成 VSIX；不包含 SDK、依赖目录、测试宿主或构建产物。

## 宿主验证

实际 VS Code 1.95.3 宿主测试已通过，退出码为 0，输出 `VUL Tools extension-host acceptance passed.`。本次在临时 Xvfb 显示环境执行 `DISPLAY=:98 npm run test:host`；测试脚本会清除终端可能继承的 `ELECTRON_RUN_AS_NODE`，确保启动真实编辑器。

DOM 自动化验证组件分类、点选、默认属性、关联版本代码、代码块与临时编辑隔离、过期提示和错误展示。宿主自动化验证语言关联、实际自定义编辑器打开/返回源码、未保存刷新、声明诊断及保存行为。

## 功能边界

结构与属性只读，实现代码框允许临时编辑但不写回文件，刷新后恢复源码。视图按进入、保存或手动刷新更新。无 C++ 语法和类型检查、表达式求值、预处理执行、跨模块兼容性检查或源码跳转。Header 保持原有语言关联。未执行 Marketplace 发布。

## 后续界面优化验证

- `npm test`：79 项通过，覆盖事务函数签名、有效握手返回值、类型名称整体加粗、仅显示显式参数、类型与 dims 合并、PARAMETER 表达式、代码框去括号和公共缩进、临时修改与刷新恢复、字体更新、C++ 词法高亮及主题刷新。
- `npm run typecheck`：通过；VS Code 1.95.3 宿主测试已在加入编辑器设置消息后复验通过。
- 宏名和名称加粗，其余参数使用相同字号和颜色但不加粗；代码框采用透明背景及 VS Code 编辑器字体设置。
- 实际宿主验证通过：加载安装的 C++ grammar，读取当前主题，并应用 editor.tokenColorCustomizations 中自定义的注释颜色；打包验证包含宿主 bundle、Oniguruma WASM 和第三方许可证，无 node_modules 运行时依赖目录。

## 项目级全局声明验证

- `npm test`：93 项通过，包括根目录优先级、相对路径与无项目、非法 PROJECT、布局冲突、递归同名 Header、读取失败恢复及精确源码缓存。
- 项目服务测试通过：Remote URI、同项目多模块共享、未保存 Header、异步旧根目录与加载期间修改保护、文件增删刷新、最近项目删除后回退祖先，以及监听和诊断释放。
- DOM 测试通过：两个独立折叠一级栏、单 Header 无额外文件层、相对路径分组、跨文件选择和草稿隔离、来源显示、过期提示及删除选择后清空。
- VS Code 1.95.3 实际宿主测试通过：项目 Header 发现、未保存 Header 的读取且不落盘、Header 保持 C++、Problems 更新、Header 保存刷新、模块 PROJECT 切换递归 Header 目录，以及文件新增和删除后的自动刷新。
- 项目级解析仅收集声明；不执行预处理、include 依赖求值、常量计算或跨文件类型与名称检查。
