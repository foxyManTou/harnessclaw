# 用户提问的系统工作时序

> 视角：用户在 Chat 页面输入框中键入一个问题并回车后，系统从前端到后端，再到 Agent 引擎之间发生的事情。
>
> 涉及的源码层： `renderer` (UI) → `preload` (Context Bridge) → `main` (Electron 主进程 + SQLite) → `harnessclaw-engine` (本地子进程, 通过 WebSocket 通信) → 上游 Claude / 工具调用 → 事件回流。

---

## 1. 参与者（Participants）

| 角色 | 物理位置 | 关键文件 |
|---|---|---|
| **User** | 桌面端 | — |
| **ChatPage** | Renderer 进程 | `src/renderer/src/components/pages/ChatPage.tsx` |
| **sessionStore** | Renderer (Zustand) | `src/renderer/src/stores/sessionStore.ts` |
| **PreloadBridge** | Preload (contextBridge) | `src/preload/index.ts` |
| **IPC Main** | Main 进程 IPC 层 | `src/main/index.ts` (`ipcMain.handle('harnessclaw:*')`) |
| **HarnessclawClient** | Main 进程 WS 客户端 | `src/main/harnessclaw.ts` |
| **SQLite (better-sqlite3)** | Main 进程 | `src/main/db.ts` |
| **harnessclaw-engine** | 本地子进程 (spawn) | `resources/bin/harnessclaw-engine` |
| **Upstream Claude / Tools** | 远程 / 本地工具 | 由 engine 内部调度 |

---

## 2. 高层时序图

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant UI as ChatPage<br/>(Renderer)
    participant Store as sessionStore<br/>(Zustand)
    participant Bridge as Preload<br/>contextBridge
    participant IPC as ipcMain<br/>(Main 进程)
    participant DB as SQLite<br/>(db.ts)
    participant Client as HarnessclawClient<br/>(WS Client)
    participant Engine as harnessclaw-engine<br/>(本地子进程)
    participant Up as Claude / 工具<br/>(上游)

    Note over User,UI: ① 输入与提交
    User->>UI: 在 SkillComposerInput 中输入问题，按 Enter
    UI->>UI: handleKeyDown → handleSend()<br/>(ChatPage.tsx:3387)
    UI->>UI: buildMessagePayload()<br/>序列化文本 + 附件块 (ChatPage.tsx:882)
    UI->>Store: updateSession({ isProcessing:true,<br/>messages:[...,{role:'user',...}] })

    Note over UI,Bridge: ② 经 Preload 到 Main
    UI->>Bridge: window.harnessclaw.send(payload, sessionId)
    Bridge->>IPC: ipcRenderer.invoke('harnessclaw:send', ...)<br/>(preload/index.ts:68)

    Note over IPC,DB: ③ 持久化用户消息
    IPC->>DB: upsertSession(sessionId)
    IPC->>DB: insertMessage({ role:'user', content })<br/>(index.ts:1655-1668)
    IPC-->>UI: broadcastDbSessionsChanged()<br/>（侧栏更新会话标题）

    Note over IPC,Engine: ④ 交给本地 Agent 引擎
    IPC->>Client: harnessclawClient.send(content, sessionId)
    Client->>Engine: WebSocket 发送 { type:'user.message', ... }<br/>(harnessclaw.ts:793-819)

    Note over Engine,Up: ⑤ 引擎 ↔ 上游 / 工具 的多轮交互
    Engine->>Up: 调用 Claude (流式) / MCP 工具

    loop 引擎流式返回事件
        Up-->>Engine: tokens / tool 调用 / tool 结果
        Engine-->>Client: WS 推送事件 (text_delta /<br/>tool_call / tool_result /<br/>permission_request / response_end / ...)
        Client-->>IPC: emit('event', payload)<br/>(harnessclaw.ts → index.ts:1206)

        par 广播到 UI
            IPC-->>Bridge: webContents.send('harnessclaw:event', ev)
            Bridge-->>UI: window.harnessclaw.onEvent(cb)<br/>(preload/index.ts:82-86)
            UI->>UI: handleHarnessclawEvent(ev)<br/>(ChatPage.tsx:2368)
            UI->>Store: 追加/更新 assistant message,<br/>tool 活动, 流式 segments
        and 落库
            alt text_delta
                IPC->>DB: ensure assistant msg<br/>+ updateMessageContent()
            else tool_call / tool_start
                IPC->>DB: insertToolActivity(type:'call')
            else tool_result / tool_end
                IPC->>DB: insertToolActivity(type:'result',<br/>duration, language, ...)
            else permission_request
                IPC->>DB: insertToolActivity(type:'permission')
            else response_end
                IPC->>DB: 写入最终 usage / token 统计
            end
        end
    end

    Note over User,Engine: ⑥ 工具权限确认（按需）
    opt 引擎请求工具权限
        UI->>User: 弹出权限 Dialog
        User->>UI: 同意 / 拒绝
        UI->>Bridge: window.harnessclaw.respondPermission(reqId, decision)
        Bridge->>IPC: ipcRenderer.invoke('harnessclaw:respondPermission')
        IPC->>Client: respondPermission(...)
        Client->>Engine: WS { type:'permission.response', ... }<br/>(harnessclaw.ts:965-1009)
    end

    Note over UI,DB: ⑦ 收尾
    Engine-->>Client: response_end
    Client-->>IPC: event('response_end')
    IPC->>DB: 标记消息完成 + 写 usage
    IPC-->>UI: 'harnessclaw:event'
    UI->>Store: updateSession({ isProcessing:false })
    UI-->>User: 渲染最终回答 + 工具活动时间线
```

---

## 3. 关键事件与数据库写入对照表

| 引擎事件 | UI 行为 | DB 写入 | 主要代码位置 |
|---|---|---|---|
| `connected` | 顶栏状态置为 connected | — | `ChatPage.tsx:2454` |
| `text_delta` | 追加流式文本到当前 assistant 段 | `insertMessage` (首块) + `updateMessageContent` | `index.ts:1512-1539` / `ChatPage.tsx:2574-2650` |
| `tool_call` / `tool_start` | 在消息上挂 tool 活动卡片 | `insertToolActivity(type='call')` | `index.ts:1426-1442` |
| `tool_result` / `tool_end` | 渲染工具结果、耗时、语言 | `insertToolActivity(type='result', duration, ...)` | `index.ts:1444-1466` |
| `permission_request` | 弹出 Dialog 等待用户决定 | `insertToolActivity(type='permission')` | `index.ts:1468-1488` |
| `subagent_event` | 嵌套渲染子 Agent 文本 / 工具 | 嵌套写入 | `index.ts:1293-1369` |
| `response` / `response_end` | 关闭 streaming，渲染 usage | 写 prompt / completion tokens | `index.ts:1541-1591` |

---

## 4. 设计要点（为什么是这样）

1. **三段式分层**：Renderer 完全只负责渲染与本地状态；所有持久化与对外通信都在 Main，符合 Electron 的安全边界（`contextIsolation` 打开，preload 仅暴露白名单 API）。
2. **WebSocket → 本地引擎**：`harnessclaw-engine` 作为独立子进程承载与 Claude / 工具的多轮调度，主进程只是「桥」。这样可以独立升级引擎，不动 Electron 外壳。
3. **同一事件双路径**：每条 engine 事件会同时被「广播给 UI」与「落到 SQLite」，UI 的实时性与历史会话回放都靠这同一份事件流；UI 离线/重启后再读 DB 即可重建时间线。
4. **权限是带外 RPC**：工具权限走单独的 `permission.response` 通道，不会阻塞主消息流，UI 只需异步把用户决定回送给引擎。

---

## 5. 文件索引（便于跳转）

- `src/renderer/src/components/pages/ChatPage.tsx:3387` — `handleSend()`
- `src/renderer/src/components/pages/ChatPage.tsx:2368` — `handleHarnessclawEvent()`
- `src/renderer/src/components/common/SkillComposerInput.tsx` — 输入组件
- `src/preload/index.ts:65-87` — `harnessclawAPI`（`send` / `onEvent` / `onStatus` / `respondPermission`）
- `src/main/index.ts:1647` — `ipcMain.handle('harnessclaw:send', ...)`
- `src/main/index.ts:1206` — engine 事件广播 + 落库分发
- `src/main/index.ts:608-643` — `startHarnessclawEngine()` 拉起子进程
- `src/main/harnessclaw.ts:793` — `HarnessclawClient.send()`
- `src/main/harnessclaw.ts:965` — `respondPermission()`
- `src/main/db.ts` — `upsertSession` / `insertMessage` / `insertToolActivity` / `updateMessageContent`
- `resources/bin/harnessclaw-engine` — 本地 Agent 引擎二进制
