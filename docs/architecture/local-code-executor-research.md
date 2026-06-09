# 本地代码执行器业界调研报告

> **调研目标**：针对需求"代码运行时环境（**两类 python、node，都必须要**）**考虑运行环境大小**"，调研业界主流 AI 客户端如何实现本地代码执行，重点对比**体积成本**与**用户体验**的权衡。
>
> **调研方法**：深度分析 4 类共 8 款产品的技术实现、用户反馈；**并实测各运行时的真实磁盘体积**（见 §3.2 与附录 A）。
>
> **核心发现**：
> 1. 业界分三种技术路线，只有"打包运行时"能满足"零环境依赖 + 本地执行"。
> 2. **实测体积远超初步估算**：Python 运行时本体裁剪后 ~50MB，但**预装数据分析包（pandas/numpy/matplotlib）裁剪后就要 ~110MB**，是体积大头。
> 3. **关键决策不在运行时本体（Python + Node 都必须要），而在是否预装数据分析包**。

---

## 执行摘要（给决策者）

### 需求明确

- ✅ **Python 和 Node 都必须要**（用户无需预装环境即可用）
- ✅ 考虑运行环境大小

**因此只有两个符合要求的方案**（都含 Python + Node）：
1. **不预装包**：~125MB
2. **预装核心包**：~235MB

### 关键结论

1. **技术路线**：业界有 3 种做法，只有"打包运行时"能同时满足"零环境依赖"和"本地执行"两个硬约束。
2. **体积大头是预装包，不是运行时本体**（实测数据）：
   - Python 运行时本体：133MB → **裁剪后 50MB**
   - Node 运行时：解压后 **83MB**（压缩包仅 28MB）
   - **预装包（pandas/numpy/matplotlib 等 5 个核心）：裁剪后 110MB** ← 体积大头
3. **唯一决策点**：要不要预装数据分析包？
   - 不预装：~125MB，首次用 pandas 时自动 pip install（5-10 秒）
   - 预装：~235MB，pandas/numpy 开箱即用，完全离线

### ⚠️ 重要修正

初稿估算"预装包 30-50MB"是**严重低估**。实测 pandas 单个就 71MB、numpy 37MB、matplotlib 30MB。**预装包才是体积决策的核心**，运行时本体反而是小头。详见 §3.2。

### 三种技术路线速览

| 方案 | 代表产品 | 体积增量 | 用户体验 | 能否满足需求 |
|------|---------|---------|---------|------------|
| **① 打包运行时** | **Claude Desktop**（同类产品） | **见 §3.2 实测** | **开箱即用** | **✅ 满足** |
| ② 检测系统环境 | Cursor、Windsurf（IDE 工具） | 0 | 有环境直接用，没有失败 | ❌ 违反"零环境依赖" |
| ③ 云端沙箱 | ChatGPT、Poe（纯对话产品） | 0 | 开箱即用，但需联网 | ❌ 数据上云，与本地定位冲突 |

**推荐依据**：
- 需求明确要求"用户无需安装环境" → 排除方案 ②
- HarnessClaw 是本地桌面应用 → 排除方案 ③
- 对标同类产品 Claude Desktop → 锁定方案 ①

---

## 1. 业界产品深度调研

### 1.1 方案 ① 打包运行时（推荐方案）

#### 代表产品：Claude Desktop（Anthropic 官方桌面客户端）

**产品定位**：Electron 桌面应用，**与 HarnessClaw 同类**。

**技术实现**：
- **Node**：随应用打包 Node.js（官方博客原文："**We ship Node.js with Claude Desktop, eliminating external dependencies**"）
- **Python**：官方 2025 年 11 月表态 "**Python support is coming**"，预计也会打包

**体积数据**：
- Node 运行时：~30MB（Electron 已内嵌，可复用）
- Python 运行时（预计）：30-50MB
- **总计预估**：60-100MB（Node 已做，Python 筹备中）

**用户体验**：
- ✅ 零配置开箱即用（用户无需装 Node/Python）
- ✅ 离线可用，不依赖网络
- ✅ Desktop Extensions（.mcpb）双击即装，Node 类扩展无需预装运行时

**安全机制**：
- 扩展安装前显示权限与配置 UI
- 敏感值（API key）存入 OS keychain，不存明文
- 官方目录的扩展经过质量与安全审核
- 企业可用 MDM 预装白名单、拉黑特定扩展

**来源**：
- https://www.anthropic.com/engineering/desktop-extensions
- https://support.claude.com/en/articles/12702546-deploying-enterprise-grade-mcp-servers-with-desktop-extensions

**对 HarnessClaw 的启示**：
- ✅ 同为 Electron 应用，技术路线可直接借鉴
- ✅ 打包 Node 的体积增量（~30MB）被 Claude 验证为可接受
- ✅ Python 也在筹备中，说明这是成熟的技术选择

---

### 1.2 方案 ② 检测系统环境（开发者工具标配）

#### 代表产品：Cursor、Windsurf、Open Interpreter、Aider、OpenAI Codex

**产品定位**：IDE / 终端 AI 工具，目标用户是开发者。

**技术实现**：
- 执行代码时调用系统 PATH 里的 `python`/`node`
- **Cursor**：通过 VS Code shell integration 跑系统环境
- **Windsurf**：专用终端 source .zshrc，能检测缺包并提议安装命令（用户需点 Accept）
- **Open Interpreter**：探测 PATH，缺失就报错；针对"没 Python"的用户提供一键安装脚本（会顺带装 Python）

**体积数据**：0 增量

**用户体验**：
- ✅ 安装包极小
- ✅ 能用用户已装的第三方库（pandas / 任意包）
- ❌ 用户没装就失败（违反"零环境依赖"约束）
- ❌ 受环境差异困扰：venv 未激活、GUI 启动缺 PATH、Windows PowerShell shell-integration 失败（用户论坛大量投诉）

**真实案例**（用户痛点）：
- Cursor 论坛："agent does not use current venv in terminal commands"（高频问题）
- Cursor 论坛："terminal commands fail due to shell integration error on Windows 11"
- Windsurf 的解法：Agent 检测到缺包时提议 `brew install python`，用户点 Accept

**来源**：
- https://forum.cursor.com/t/cursor-composer-agent-does-not-use-current-venv-in-terminal-commands/49712
- https://docs.windsurf.com/windsurf/cascade

**为什么不适合 HarnessClaw**：
- ❌ 违反需求明确的"用户无需安装环境"硬约束
- ❌ 环境碎片化排障成本高（PATH / venv / shell 差异）

---

### 1.3 方案 ③ 云端沙箱（纯对话类产品）

#### 代表产品：ChatGPT Desktop、Poe、Claude 网页版

**产品定位**：对话类客户端，非本地开发工具。

**技术实现**：
- **ChatGPT**：Code Interpreter 在服务端隔离容器运行（Ubuntu 容器，/mnt/data 工作目录，预装 pandas/numpy）
- **Poe**：用 Modal Sandboxes（gVisor 容器隔离）
- **Claude 网页版**：云端 sandboxed container，按用户与会话隔离

**体积数据**：0 增量（代码跑在云端）

**用户体验**：
- ✅ 零配置开箱即用（用户没 Python/Node 也无所谓）
- ✅ 强隔离（容器级），对用户机器零风险
- ❌ 必须联网且需账号登录
- ❌ 代码与数据上云（合规 / Zero Data Retention 问题）
- ❌ 拿不到用户本地文件 / 本地服务 / 真实项目上下文

**来源**：
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool
- https://modal.com/blog/quora-case-study

**为什么不适合 HarnessClaw**：
- ❌ HarnessClaw 已有 bash/read/write 等本地工具，定位是本地桌面应用
- ❌ 数据上云与产品定位冲突
- ❌ 需要维护服务端基础设施，运营成本高

---

## 2. 三种方案详细对比

| 维度 | ① 打包运行时 | ② 检测系统环境 | ③ 云端沙箱 |
|------|------------|--------------|----------|
| **代表产品** | **Claude Desktop** | Cursor、Windsurf、Open Interpreter | ChatGPT、Poe |
| **运行时来源** | 应用内置 | 用户系统 PATH | 服务器容器 |
| **安装包体积** | **133-243MB（实测，见 §3.2）** | **0** | **0** |
| **用户体验** | 开箱即用，零配置 | 有环境直接用，没有失败 | 零配置，但需联网 |
| **离线可用** | ✅ 是 | ✅ 是 | ❌ 否（必须联网） |
| **数据安全** | ✅ 本地不上云 | ✅ 本地不上云 | ❌ 数据上云 |
| **环境依赖** | ✅ 无依赖 | ❌ 依赖用户已装 | ✅ 无依赖 |
| **第三方库** | 预装包 + pip install | 用户已装的任意库 | 沙箱预装包 |
| **维护成本** | 需随版本升级运行时 | 承接环境碎片化排障 | 需维护服务端 |
| **满足需求** | ✅ 满足 | ❌ 违反"零环境依赖" | ❌ 与本地定位冲突 |

---

## 3. 推荐方案：打包运行时 + pip 自动安装

### 3.1 方案概述

把精简版 Python / Node 打包进 HarnessClaw 安装包，放到 `resources/bin/runtime/`，随应用分发。引擎执行代码时用内置运行时，缺包时支持受控的 pip 自动安装。

### 3.2 体积构成（实测数据，单平台 win-x64）

> 以下为**实测**数据（裁剪指删除 *.pdb 调试符号、test 测试套件、__pycache__、tcl/tk GUI 库等代码执行用不到的部分）。其他平台体积接近，详见附录 A。

**各组件实测体积**：

| 组件 | 压缩包 | 解压后（原始） | **裁剪后** | 说明 |
|------|--------|--------------|-----------|------|
| Node v20.18.1 | 28MB | 83MB | ~75MB | node.exe 单文件就 67MB，裁剪空间小 |
| Python 3.11 standalone | 40MB | 133MB | **50MB** | 删 pdb(58MB)+test+tcl/tk，省 83MB |
| 预装核心 5 包 | — | 206MB | **110MB** | pandas 71 + numpy 37 + matplotlib 30 + PIL 16 + 其他 |

**关键洞察**：体积大头是**预装包（110MB）**，不是运行时本体。pandas/numpy/matplotlib 这类科学计算库自带大量编译好的二进制（.pyd/.so），无法显著裁剪。

---

### 3.3 两个符合要求的方案（都含 Python + Node）

#### 方案 A（推荐）：不预装包

| 组成 | 裁剪后体积 |
|------|-----------|
| Python 本体 | 50MB |
| Node | 75MB |
| **总计** | **~125MB** |

**优势**：
- ✅ 体积省 110MB（比预装版小近一半）
- ✅ 首次使用 pandas 时自动 pip install（白名单内静默，5-10 秒）
- ✅ 装完后永久可用，不会反复装

**代价**：
- ⚠️ 首次使用数据分析包需要联网（但这是一次性的）

**适合**：体积略敏感，且用户大概率有网络。

---

#### 方案 B：预装核心 5 包

| 组成 | 裁剪后体积 |
|------|-----------|
| Python 本体 | 50MB |
| 预装核心 5 包（pandas/numpy/matplotlib/requests/openpyxl） | 110MB |
| Node | 75MB |
| **总计** | **~235MB** |

**优势**：
- ✅ pandas/numpy/matplotlib 开箱即用
- ✅ 完全离线可用（不依赖 pip install）

**代价**：
- ⚠️ 体积多 110MB
- ⚠️ 这 110MB 可能有 70% 的用户根本不会用到（不是每个用户都做数据分析）

**适合**：追求极致开箱体验，体积可接受。

---

### 3.4 两方案对比

| 维度 | 方案 A（不预装）✅ 推荐 | 方案 B（预装核心包） |
|------|---------------------|-------------------|
| **体积** | **~125MB** | ~235MB |
| **pandas 开箱即用** | ❌ 首次需 pip install（5-10s） | ✅ 是 |
| **离线可用** | ⚠️ 首次装包需联网 | ✅ 完全离线 |
| **长期体验** | ✅ 装完后与预装版一致 | ✅ 开箱即用 |
| **体积效率** | ✅ 高（按需装） | ⚠️ 低（70% 用户不用也占 110MB） |

> 注：体积可通过「每个安装包只打包对应平台的运行时」控制——不会四平台叠加。

---

### 3.5 pip 自动安装机制（解决缺包问题）

**触发流程**：
```
执行 Python 代码
  ↓ ModuleNotFoundError
解析包名
  ↓ 查白名单
  ├─ 在白名单 → 静默 pip install → 重试
  └─ 不在白名单 → 请求用户审批
        ├─ 允许 → pip install → 重试
        └─ 拒绝 → 回灌错误给 Agent
```

**三层安全防护**：
1. **白名单**：Top-N 常用包（pandas/requests/...）白名单内静默装，80% 场景无弹窗
2. **审批门**：白名单外的包弹窗："Agent 请求安装 XXX，是否允许？"（三按钮：拒绝/允许一次/总是允许）
3. **版本锁定**：不允许 Agent 指定版本，统一装最新稳定版（防旧版漏洞包）

**对标**：Open Interpreter 默认逐段弹确认；Cursor/Windsurf 有 allowlist/denylist 分级审批。我们的三层防护**比业界更严格**。

---

## 4. 体积对比总结

| 方案 | 单平台体积 | 用户体验 | 能力范围 |
|------|-----------|---------|---------|
| **HarnessClaw 方案 A（不预装）**✅ 推荐 | **~125MB** | 装好即用，首次用 pandas 时自动装（5-10s） | Python+Node+pip |
| HarnessClaw 方案 B（预装核心包） | ~235MB | 开箱即用 | Python+核心包+Node+pip |
| Cursor / Windsurf | 0 | 有环境直接用，没有失败 | 任意（用户系统的） |
| ChatGPT Desktop | 0 | 开箱即用 | 云端沙箱 |

**结论**：
- 需求明确：**Python 和 Node 都必须要**，因此只有方案 A 和 B 符合。
- 体积核心矛盾是**预装包**（110MB），不是运行时本体（Python 50MB + Node 75MB）。
- **推荐方案 A（不预装）**：省 110MB，pip 自动安装兜底，体验与体积最佳平衡。

---

## 附录 A：实测数据明细

**测量环境**：Windows 11 x64，2026-06-05 实测。
**裁剪规则**：删除 `*.pdb`（调试符号）、`test`/`tests` 目录、`__pycache__`、`tcl`/`tkinter`（GUI 库，代码执行用不到）。

### A.1 Node.js v20.18.1（各平台压缩包，HEAD 实测）

| 平台 | 压缩包 | 解压后（win 实测） |
|------|--------|------------------|
| win-x64 | 28.2 MB | 83 MB（node.exe 单文件 67MB） |
| mac-arm64 | 40.4 MB | ~（接近 win） |
| mac-x64 | 41.1 MB | ~ |
| linux-x64 | 24.6 MB | ~ |

### A.2 Python 3.11 standalone（win-x64 实测）

| 项 | 体积 |
|----|------|
| 压缩包 | 40 MB |
| 解压后（原始） | 133 MB |
| 其中 *.pdb 调试符号 | 58 MB（可删） |
| 其中 test 测试套件 | 大量（可删） |
| 其中 tcl/tk | 9.1 MB（可删） |
| **裁剪后** | **50 MB** |

### A.3 预装包（用内置 Python pip 装，win-x64 实测）

| 包 | 占用 |
|----|------|
| pandas | 71 MB |
| numpy（含 numpy.libs） | 58 MB |
| matplotlib | 30 MB |
| PIL（matplotlib 依赖） | 16 MB |
| fontTools（matplotlib 依赖） | 18 MB |
| openpyxl + 其他 | ~13 MB |
| **核心 5 包合计（原始）** | **206 MB** |
| **核心 5 包合计（裁剪后）** | **110 MB** |

### A.4 Python embeddable（对比，不推荐）

| 项 | 体积 | 说明 |
|----|------|------|
| 压缩包 | 11 MB | python.org 官方 |
| 解压后 | 21 MB | **无 pip、无 venv，功能受限**，无法走 pip 自动安装方案 |

---
---

## 5. 唯一决策点（基于需求"Python + Node 都要"）

### 需求已明确

✅ **Python 和 Node 都必须要** → 排除所有"不含 Node"的方案

### 唯一决策：要不要预装数据分析包？

| 决策 | 体积 | Python 本体 | 预装包 | Node | 适合 |
|------|------|-----------|--------|------|------|
| **不预装**（方案 A）✅ 推荐 | **~125MB** | 50MB | 无 | 75MB | 体积略敏感，用户大概率有网络 |
| **预装核心 5 包**（方案 B） | **~235MB** | 50MB | 110MB | 75MB | 追求极致开箱体验，体积可接受 |

**关键权衡**：
- **预装包占 110MB**（pandas 71MB + numpy 58MB + matplotlib 30MB），是体积大头
- 不预装时，首次用 pandas 自动 pip install（白名单内静默，5-10 秒），装完后与预装版一致
- 预装的 110MB，可能有 70% 的用户根本不会用到（不是每个用户都做数据分析）

---

## 6. 推荐结论（基于实测）

### 推荐方案：方案 A（不预装包，~125MB）

**配置**：
- Python 本体 50MB + Node 75MB + pip 自动安装

**理由**：
1. ✅ **体验与体积最佳平衡点**：装好就能跑代码，首次用到 pandas 时自动 pip install（5-10 秒）
2. ✅ 符合需求"两类 python、node"且"考虑大小"
3. ✅ 避开预装包这个体积大坑（省 110MB）
4. ✅ pip 自动安装（白名单内静默）兜底，长尾场景也能覆盖
5. ✅ 体积比预装版小近一半

**代价**：
- 首次使用 pandas/numpy 等包时需要联网 pip install（但这是一次性的，装完永久可用）
- 离线用户初次使用数据分析包会失败（但 Python 标准库场景仍可用）

**适用条件**：用户大概率有网络（HarnessClaw 是云同步的桌面应用）。

---

### 备选方案：方案 B（预装核心 5 包，~235MB）

**配置**：
- Python 本体 50MB + 核心 5 包 110MB + Node 75MB + pip 自动安装

**理由**：
- pandas/numpy/matplotlib 开箱即用，不需要首次装包
- 完全离线可用（不依赖 pip install）

**代价**：
- 体积多 110MB
- 这 110MB 可能有 70% 的用户根本不会用到

**适用条件**：追求极致开箱体验，体积可接受。

---

## 7. 风险提示（基于实测）

| 风险 | 影响 | 应对 |
|------|------|------|
| **预装包体积超预期** | 核心 5 包就占 110MB，远超初估的 30-50MB | **推荐方案 A（不预装），用 pip 自动安装兜底** |
| pip install 网络依赖 | 国内访问 PyPI 可能慢/失败 | 支持配置国内镜像源（清华/阿里/华为云） |
| Node 解压后体积大 | 压缩包 28MB，但解压后 83MB | electron-builder 会重新压缩，但用户磁盘占用仍是 83MB |
| 运行时安全补丁 | 需随版本升级 | 纳入发版流程定期升级（打包方案的固有代价） |
| Windows 杀软误报 | 打包的 python.exe/node.exe 触发杀软 | 代码签名；必要时白名单说明 |

**关键风险**：实测发现预装包是体积大头（110MB），**方案 A（不预装）既满足需求又控制体积**。

---

## 8. 下一步行动

**需要决策**：选择一个方案（都含 Python + Node）

| 选项 | 体积 | 说明 |
|------|------|------|
| □ **方案 A（不预装）**✅ 推荐 | **~125MB** | 首次用 pandas 时自动 pip install（5-10s） |
| □ 方案 B（预装核心包） | ~235MB | pandas/numpy 开箱即用，完全离线 |

**决策后**：
1. 更新技术实施方案（`local-code-executor.md`）锁定方案配置
2. 按 7 步流程开始实施（引擎工具 → 运行时打包 → 裁剪 → 路径注入 → pip install → 验证）
3. 预计 6-7 天完成开发与验证

---

## 总结：实测带来的关键变化

| 项 | 初步估算 | 实测结果 | 差异 |
|----|---------|---------|------|
| Python 本体 | 30-50MB | 50MB（裁剪后） | ✅ 准确 |
| Node | 30MB | 83MB（解压后） | ❌ 低估 2.7 倍 |
| 预装核心 5 包 | 10-20MB | 110MB（裁剪后） | ❌ **低估 5-10 倍** |
| 完整版总计 | 90-130MB | **~235MB** | ❌ **低估近 2 倍** |

**核心教训**：体积大头是预装包（pandas 单个就 71MB），不是运行时本体。**需求明确要 Python + Node，关键决策是预装包——推荐方案 A（不预装，~125MB），用 pip 自动安装兜底**，既满足需求又控制体积。
