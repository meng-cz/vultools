# VUL Tools 声明解析

规则表在 `src/parser/rules.ts`，基于 `install/userguide/0-declarations.md` 及模块、Header、Main 手册。运行时无需访问手册或 SDK。

| 分类 | 声明 |
| --- | --- |
| 参数与类型 | CONFIG、PARAMETER、ALIAS、STRUCT、ENUM |
| 状态与资源 | REGISTER、WIRE、QUEUE、BRAM、ROM |
| 接口 | REQUEST、SERVICE、QUERY、USE_CHILD_SERVICE、USE_CHILD_QUERY |
| 子模块与连接 | CHILD_INSTANCE、CONNECT_CR_CS、CONNECT_CR_S、CONNECT_CR_R、CONNECT_S_CS |
| 行为与容器 | HELPER、TICK_IMPL、INTERFACE、VERSION、USE_VERSION |
| 流水线 | PIPELINE、IREG、OREG、IVALID、OVALID |
| 测试入口 | TOP、PROJECT、GLOBAL、SIMULATION |

所有 API 属性均支持文档规定的位置或命名形式。检查必填、默认值、重复属性、业务参数尾序列、PARAM 覆盖、维度列表、握手字面量、基础正整数字面量及 BRAM mode。表达式和 C++ 类型按原文保留，不求值或解析类型语义。

解析器保留接口与版本归属，关联 SERVICE/QUERY 声明及实现，并检查可直接比较的签名。不同版本的同名声明不会合并为同一个组件。PIPELINE 端点作为子组件，IREG 复位代码与流水线代码分别保留。

`TICK_IMPL()` 可附加展示名称，例如 `TICK_IMPL(update_count)` 或 `TICK_IMPL(name=update_count)`，便于区分多个周期行为块；名称不参与符号唯一性检查或行为语义。

可视化列表将子接口引出与连接放在 Submodules and Connections 下，按 CHILD_INSTANCE 分组。CR-CS 连接同时出现在源和目标子实例下；CR-S / CR-R 归入源实例，S-CS 归入目标实例。数组端点归入同一实例声明，版本之间独立分组，尚未找到实例声明的条目仍保留可见。

代码块仅扫描词法边界与花括号平衡。函数调用、C++ 表达式或类型是否合法不在检查范围。预处理器不运行，条件编译内容保留条件标签，自定义宏输出不展开。因此声明检查不能替代 VUL 生成器验证。

解析入口接受 `module`、`testbench`、`header` 三种文件范围；扩展对 `.vul`、`.utb` 文档执行声明检查；项目级可视化另外收集 Header 并以 `header` 模式解析，在对应 Header 发布声明诊断，但保持其 C++ 文件关联。

组件属性保留显式值和默认值；解析模型中的代码块保持原始字符和换行。范围使用 JavaScript / VS Code UTF-16 偏移。可视化列表合成目标类型字符串，不进行类型解析或维度求值：ALIAS / QUERY 使用 name → type，REGISTER、QUEUE、BRAM、WIRE、IREG、OREG 使用 name<type>，维度融合进类型。整个名称与类型加粗，API 表仍显示原始属性。

REQUEST / SERVICE 按原有业务参数顺序显示 name(T arg, U & resp)，其中 ARG 显示类型与名称，RESP 加引用符号；有效握手显示 -> bool，SERVICE 的 ready 隐含握手也适用。列表仅展示未合并到名称的显式参数，不展示补全的默认值；详情表保留全部属性及默认值来源。

实现代码在可编辑 textarea 组件中展示，完整代码块去掉外层花括号、边界空行和公共缩进；Tab 根据编辑器宽度换算，内部相对缩进保留。代码框使用 VS Code 编辑器字体设置，背景与编辑器一致。修改只缓存于当前 Webview，不改变解析模型或文件，刷新时丢弃。源文本通过文本节点或 textarea.value 渲染，不作为 HTML 执行。

高亮使用宿主侧 TextMate / Oniguruma，复用可用 C++ 语法定义、主题 tokenColors 和 editor.tokenColorCustomizations，支持 JSONC 主题及 include。浏览器的 textarea 与安全文本高亮层叠加，共用字体、行高和滚动位置。临时代码通过 highlight 消息请求着色，highlightResult 返回 UTF-16 token 范围和颜色，不修改文档；按请求 ID 丢弃过期结果。ready、refresh、source 保持原有功能，editorSettings 更新字体，highlightThemeChanged 请求重新着色。词法高亮独立于声明检查，也不提供 C++ 语义诊断。

## 项目级解析

`src/project.ts` 提供不依赖 VS Code 的项目定位和 Header 收集；`src/projects.ts` 负责 URI 文件访问、共享缓存、文件监听、文档版本保护和 Header 诊断。项目设置覆盖优先于模块 PROJECT，再向上查找；无效显式绑定不回退。PROJECT 只允许在模块顶层出现一次，路径为普通双引号字符串字面量（支持 JSON 形式转义），相对模块目录解析。PROJECT 元数据不影响 INTERFACE 与 USE_VERSION 的位置约束。

每个 Header 单独调用解析器，保留来源 URI、文档版本、未保存标记、UTF-16 行起始位置、解析结果或读取错误。Header 目录递归收集 `.h/.hpp` 并按相对路径排序，递归不跟随符号链接；单文件与目录布局互斥。不同文件的 CONFIG / ALIAS 等不会被合并；不检查跨文件重名、不计算 include 依赖或常量表达式。某个文件失败不影响其他文件和模块结果。

Webview 的 snapshot 增加 project（根目录、布局、各文件结果、revision、stale 和消息）；模块 refreshId 独立标识显式刷新。组件与关联 ID 在浏览器中用 JSON 编码的 `[文件 URI, 文件内 ID]` 隔离，临时代码草稿使用同一文件上下文。来源、属性、诊断、代码与高亮上下文均绑定到选中文件；Header 字体读取对应资源的 C++ 编辑器设置。

两个一级栏和 Header 文件栏采用原生 details/summary，可键盘操作，展开状态保存在 Webview state。全局更新不清除模块草稿；过期结果保留展示并提示刷新，重新解析该部分后恢复其源码代码。Header 编辑立即使项目结果过期并清理旧诊断；保存或文件变更时合并刷新。异步根目录识别与 Header 读取使用绑定身份、缓存代次和文档版本校验，旧任务不得提交到新的绑定。
