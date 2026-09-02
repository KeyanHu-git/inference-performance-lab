# ChronoScope Model Load

ChronoScope 是一个面向大模型启动实验的证据驱动时间线工作台。它将编译后的模型加载事件组织为可比较、可下钻的语义时间线，用于观察阶段耗时、并行分支、节点关系与实验差异。

在线版本：<https://chronoscope-model-load.phycheor.chatgpt.site/>

## 当前能力

- 对比多组 DeepSeek 与 GLM 模型加载实验；
- 展示启动、权重加载、MTP、Graph 捕获和服务就绪等阶段；
- 按父子关系逐级展开细分节点；
- 标识确认关系、推断关系和不完整实验；
- 支持缩放、局部放大、基线对比和实验备注；
- 通过统一时间线接口同时服务网页与 CLI。

仓库包含编译后的演示时间线数据，不包含原始集群日志、认证信息或模型权重。

## 本地运行

要求 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

默认地址为 <http://localhost:3000/>。

## 校验与构建

```bash
npm run timeline -- validate
npm run lint
npm run build
```

## 数据边界

原始证据、语义解释和页面布局相互分离：

```text
Evidence
→ ExtractedEvent
→ Interpretation
→ SemanticTimeline
→ LayoutProjection
```

页面只读取编译后的时间线产物，不直接连接集群，也不修改原始日志。

## 项目状态

当前版本聚焦模型启动与权重加载。推理请求链路、算子 Profiler、资源指标和自动优化仍处于设计阶段。

## 许可证

当前仓库尚未附加开源许可证。公开可见不等于授予复制、修改或分发权限。
