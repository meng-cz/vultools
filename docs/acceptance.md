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

DOM 自动化验证组件分类、点选、默认属性、关联版本代码、原样且不可编辑的代码块、过期提示和错误展示。宿主自动化验证语言关联、实际自定义编辑器打开/返回源码、未保存刷新、声明诊断及保存行为。

## 功能边界

可视化只读，按进入视图、保存或手动刷新更新。无 C++ 语法和类型检查、表达式求值、预处理执行、跨模块兼容性检查或源码跳转。Header 保持原有语言关联。未执行 Marketplace 发布。
