### 新增

- 左侧导航新增 X·LAB 实验室入口（位于「首页」与「技能」之间，烧瓶图标），用作阶段性实验功能的承载页，不与已有页面相互干扰。
- 执行卡新增「继续 / 重试 / 取消」决策门：当某个步骤的重试预算或整个计划的 re-plan 预算耗尽，引擎不再静默放弃，而是上浮一张决策卡（v0.5.0 §7.1/§7.3），用户可在 UI 上明确告诉系统下一步怎么走，并可附加备注；决策回执通过 `prompt.user_response` 回写引擎。
- Scheduler 在自动重试时下发的状态提示（例如"重试中 (3/3, 1.5s 后再试) — network_error"）会以 `engine_note` 形式透传到对话框上方临时横幅，调度过程不再黑盒。
- 设置页拆出独立的「软件设置」分区。日志等级（控制实际写入日志文件的最低等级）从「日志」模块迁到此处；「日志」页面仅保留筛选当前展示的等级，不再产生"调一下就改写盘上日志"的歧义。

### 修复

- Specialists / Task 等容器型工具卡不再被服务端 watchdog 的合成 `orphan_timeout` close 误报失败。客户端在 forest 中发现仍有未关闭子卡时直接丢弃该 close，UI 不再出现"工具失败但步骤仍在执行"的矛盾画面（与服务端 P0/P1 修复协同生效，并保留为防御纵深，覆盖将来同类回归）。
- 延迟到达的 `card.close` 帧若携带 `inner.step_id=""` 等空字符串字段，不再覆盖卡片原有的非空值。修复前会导致后续 `engine_note` / `step.*` 事件因找不到所属 step 而被静默丢弃。
- 计划草稿（PlanDraftCard）的步骤拖拽改用「间隙位置」判定——鼠标处于条目上半部表示插到该项之前、下半部表示插到之后；任何项现在都可以真正成为最后一项，拖入子节点时插入指示线也不再闪烁。

### 变更

- 引擎模板 `harnessclaw-engine.yaml` 默认值整理：`channels.websocket.client_tools` 默认改为 `false`（服务端跑工具的标准模式，匹配 Web UI 用法）、`tavily_search` 默认关闭、`llm.api_timeout` 放宽到 `900s` 并新增 `first_byte_timeout: 120s` 看门狗、新增 Console Management API 节、移除已废弃的 `session.storage` 字段；同时补充各字段的中文/英文用途说明。
- `ws send` / `ws recv` 中的 `ping` / `pong` 心跳帧不再写入 frame 追踪日志，避免 service.log 在长时间空闲时被心跳噪声淹没；功能性帧（`card.add`/`card.close`/`card.tick`、`user.message` 等）仍正常记录。
