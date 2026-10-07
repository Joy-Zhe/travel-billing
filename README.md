# 同行账本

中文、手机优先的多人旅行记账应用。网站入口公开，ChatGPT 登录后仅能访问自己创建或加入的旅行。

## 功能

- 创建旅行、邀请成员、七天有效邀请链接和重置。
- 单币种记账（CNY/HKD/USD/EUR/JPY），指定一位垫付人和实际参与均分的成员。
- 整数金额计算、精确分摊明细、确定性转账建议和实际还款记录。
- 全体成员共享管理账单和还款；创建者管理旅行设置及归档。
- 每十五秒同步，窗口获得焦点及保存后刷新；版本冲突提示刷新，不静默覆盖。
- 公开的只读示例，与真实账本数据完全分离。

## 本地运行

需要 Node.js 24（包含测试使用的 node:sqlite）和 Git。应用运行最低版本为 Node.js 22.13。

```sh
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_silent_thundra.sql
npm run dev -- --hostname 127.0.0.1
```

本地预览访问 http://127.0.0.1:5173 。本地登录由模板模拟为 Seedy，模拟逻辑不会包含在生产构建中。预览数据库和线上数据库完全独立，不把本地测试数据发布到线上。后续新增迁移按顺序执行，不重复执行已应用的迁移。

Windows 如遇 npm.cmd 路径错误，可通过 Node 直接运行实际安装目录中的 npm/bin/npm-cli.js，或直接使用 node scripts/run-framework.mjs dev/build。

## 验证

```sh
npm run typecheck
npm test
npm run build
```

测试使用内存 SQLite 执行正式迁移与服务 SQL，覆盖均分、成员权限、邀请、幂等、并发冲突、原子回滚、还款、归档、币种锁定及余额守恒。

浏览器 QA 使用本机 Edge 和 Playwright，工具依赖与截图位于忽略的 .sites-runtime/qa 与 outputs 目录。真实双 ChatGPT 账号登录仍需要相应用户会话；自动化测试采用隔离的模拟身份，不代表实际 OAuth 流程已通过双账号验证。

## 接口与持久化

- GET /api/me：当前用户；匿名返回 null。
- GET/POST /api/trips：本人旅行列表、创建旅行。
- GET/PATCH /api/trips/:id：一致性账本快照、旅行设置/归档。
- POST /api/trips/:id/invite：创建或重置邀请。
- GET/POST /api/invites/:token：邀请简介、确认加入。
- POST /api/trips/:id/expenses；PATCH/DELETE /api/trips/:id/expenses/:expenseId。
- POST /api/trips/:id/repayments；PATCH/DELETE /api/trips/:id/repayments/:repaymentId。
- GET /api/trips/:id/settlement：成员余额、转账建议及还款记录。

旅行修改及账目写入需要 version 与 requestId；新增账目幂等，同一标识不可用于不同请求。金额为币种最小单位的整数，每笔最高 1,000,000,000 最小单位。支出和分摊以 D1 batch 原子提交，所有写入由旅行版本及唯一操作令牌保护。

代码入口为 app/ledger-app.tsx、app/api/[...path]/route.ts。计算与服务位于 lib/core.ts、lib/service.ts；Drizzle schema 在 db/schema.ts。

## Sites 部署

.openai/hosting.json 保存此应用的项目标识与 DB 绑定。源码和构建归档由 Sites helper 同步与打包，再保存版本并部署；平台部署时应用数据库迁移。后续发布复用现有 project_id，保持公开入口。所有旅行数据访问仍由后端登录与成员权限验证。

第一版不支持多币种兑换、自定义分摊、真实支付、票据识别、离线写入、移除成员或删除旅行。已有支出历史会永久锁定币种；请先记录支出再登记还款。
