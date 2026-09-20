# 全球股市涨幅排行

全球各国主权股指的涨幅排行榜。目标形态为微信小程序，当前处于 **P1 数据底座** 阶段，
已产出可双击打开的单文件 HTML 原型用于验证数据口径。

## 文档

| 文档 | 给谁看 |
|---|---|
| [docs/TODO_USER.md](docs/TODO_USER.md) | **你** —— 需要你亲自做的事项清单 |
| [docs/STATUS.md](docs/STATUS.md) | 整体进展、验证记录、已知问题 |
| [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) | 产品方案（自包含，供产品评审） |
| [docs/NEW_SESSION_PROMPT.md](docs/NEW_SESSION_PROMPT.md) | 开新 session 做产品评审的启动 prompt |
| [docs/REGISTER_SESSION_PROMPT.md](docs/REGISTER_SESSION_PROMPT.md) | 开新 session 带你注册 AppID + 云开发环境 |
| [docs/ADVERSARIAL_REVIEW_PROMPT.md](docs/ADVERSARIAL_REVIEW_PROMPT.md) | 开新 session 做对抗性审查（找 bug + 金融视角 UI） |
| 本文件 | 工程说明、用法、数据陷阱 |

最初的技术方案见 `~/.claude/plans/1-2-3-elegant-sphinx.md`。

## 当前进度

| 阶段 | 状态 |
|---|---|
| P1 数据底座 | ✅ 完成（数据源、汇率、快照计算、质量检查、HTML 原型） |
| P2 云端化（CloudBase 云函数 + 定时触发） | 未开始 |
| P3 小程序前端 | 未开始 |
| P4 热力图 / 分享长图 | 未开始 |
| P5 发布（待企业主体就绪） | 阻塞：个人主体无法发布金融类目 |

**当前数据覆盖 18 / 48 个指数**，因为本机全局代理导致东财源不可用（见下）。

## 用法

```bash
python3 scripts/fetch_indices.py      # 抓指数日线(带缓存, 当日已抓则跳过)
python3 scripts/fetch_fx.py           # 抓汇率
python3 scripts/check_data.py         # 数据质量检查, 有问题时退出码为 1
python3 scripts/build_snapshot.py     # 算快照 -> data/app_data.json
python3 scripts/build_prototype.py    # 注入数据 -> prototype/index.html
```

`prototype/index.html` 双击即可打开，数据已内联，无需服务器。

## ⚠️ 补齐剩余 30 个指数

本机 `HTTP_PROXY=127.0.0.1:10808` 把全部流量导向机房 IP（`45.76.215.254`），
**东方财富对机房/境外 IP 直接拒连**，因此依赖东财的 30 个指数全部抓取失败。

关闭全局代理后重跑即可补齐：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY python3 scripts/fetch_indices.py --force
```

同理，`LKR / PKR / VND` 三种汇率依赖 Yahoo 备源，也需在非机房 IP 下才能取到。
云函数环境不存在此问题。

## 数据源

| 用途 | 主源 | 备源 |
|---|---|---|
| 指数日线 | 东方财富 `push2his`（48 个，需国内 IP，必须带 `ut` 参数） | 新浪 `gi.finance.sina.com.cn`（18 个，**上限 1000 条约 4 年**） |
| 汇率 | Frankfurter / 欧洲央行（25 种，可回溯至 1999） | Yahoo `{CCY}=X`（补 LKR/PKR/VND） |

**限速**：东财实测连发 9 个无间隔请求会被封 IP 数小时。`fetch_indices.py` 默认间隔 0.45s。

## 已知数据陷阱（均已在代码中处理）

1. **新浪休市日返回 `c="0"`** — 字符串 `"0"` 为真值，若只判 `if r.get("c")` 会让 0 混入，
   污染跨该日的全部区间计算。实测印尼指数有 7 处、印度 4 处。已显式剔除非正数。
2. **欧洲央行停发新台币汇率**（最后更新 2020-10-30）— 拿陈旧汇率算近期涨幅会产生
   离谱且不易察觉的错误。`fetch_fx.py` 对滞后超过 30 天的货币一律按缺失处理。
3. **新浪源只有约 4 年历史** — 因此「近5年」窗口对新浪源指数显示「—」。
   补齐东财源后自动恢复。
4. **数据起点晚于窗口起点** — 显示「—」，不拿首日数据充数。

`check_data.py` 会持续监控这几类问题。注意它也会报出**真实的市场事件**，需人工定性：
已确认属正常的有 印尼开斋节休市、台湾春节休市、日经 2024-08-05 单日 -12.4%、
韩国 2026 年的剧烈波动（已对 Yahoo 交叉验证）。

## 数据口径

- **价格指数，不含股息。** 各国股息率差异显著，长周期比较会系统性低估高股息市场。
- **三种计价口径**：本币 / 美元 / 人民币。换算公式 `点位 ÷ (1美元兑本币汇率)`，
  区间两端各自按其对应日期的汇率换算。跨国比较应看美元口径。
- **交易日对齐**：每个指数取自己最近一个已收盘交易日；区间起点取「该日或之前最近
  一个交易日」的收盘价，不插值。

## 验证记录（2026-09-19）

对 Yahoo Finance 交叉验证，全部精确匹配：

| | 本项目 | Yahoo |
|---|---|---|
| 韩国 KOSPI 收盘 | 6,894.23 | 6,894.23 |
| 台湾加权 | 47,180.75 | 47,180.75 |
| 印尼 JKSE | 6,441.16 | 6,441.16 |
| KOSPI 2025 年末基准 | 4,214.17 | 4,214.17 |
| KOSPI YTD 本币 | +63.60% | — |

日经 225 的本币/美元/人民币三口径换算亦已手工逐步验算一致。

## 目录

```
scripts/indices.py          48 个指数的元数据(代码/国家/货币/数据源)
scripts/nethttp.py          统一 HTTP 工具(本机 Python 缺 CA 证书, 用 certifi)
scripts/fetch_indices.py    指数日线抓取(多源 + 限速 + 缓存)
scripts/fetch_fx.py         汇率抓取(含停更检测)
scripts/check_data.py       数据质量检查
scripts/build_snapshot.py   快照计算 -> data/app_data.json
scripts/build_prototype.py  单文件 HTML 打包
prototype/template.html     原型模板(含 /*__DATA__*/ 占位符)
prototype/index.html        生成物, 双击可开
data/raw/                   原始缓存(逐指数 JSON + fx.json)
```
