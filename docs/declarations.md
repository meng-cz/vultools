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

代码块仅扫描词法边界与花括号平衡。函数调用、C++ 表达式或类型是否合法不在检查范围。预处理器不运行，条件编译内容保留条件标签，自定义宏输出不展开。因此声明检查不能替代 VUL 生成器验证。

解析入口接受 `module`、`testbench`、`header` 三种文件范围；扩展仅对 `.vul`、`.utb` 文档自动执行。Header 解析能力用于规则测试，不接管 `.h/.hpp` 或发布其诊断。

组件属性保留显式值和默认值；代码块保持原始字符和换行。范围使用 JavaScript / VS Code UTF-16 偏移。可视化通过文本节点渲染源代码，消息接口只接受 ready、refresh、source，不提供任何写入动作。
