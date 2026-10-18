# 好友圈 · 桌面客户端

Electron + React 写的好友圈客户端，直连你自己部署的 moment 服务端，
用 [`@caremiumos-dev/node-moment-sdk`](https://www.npmjs.com/package/@caremiumos-dev/node-moment-sdk) 收发数据。
和手表上看到的是同一份数据：这里发的动态戴表的人能看到，手表上发的这里也能刷到。

## 为什么是 Electron

SDK 是 Node 客户端，不是浏览器库：

- `client.ts` 引 `node:crypto` 算图片 md5、`node:fs/promises` 读本地文件；
- `publishMoment` 收的是**本地文件路径**，不是浏览器的 `File` 对象；
- 服务端整套接口没有任何 CORS 头，网页里跨源 fetch 会被浏览器拦掉。

所以主进程是唯一能跑 SDK 的地方。渲染进程通过 preload 暴露的白名单 IPC 拿数据，
`nodeIntegration` 关闭、`sandbox` 开启，chipId 永远不出主进程。

## 跑起来

```sh
npm install
npm run dev
```

首次进入要填三项：

| 字段 | 说明 |
| --- | --- |
| 服务器地址 | 形如 `http://127.0.0.1:8000` 或 `https://moment.example.com` |
| watchId | 账号的 watchId（服务端后台的账号详情里有） |
| chipId | 设备芯片号，**等同账号密码** |

勾选「记住这台设备」后，chipId 用系统密钥（Windows DPAPI / macOS Keychain）加密后存在
`<userData>/account.json`。系统不支持加密存储时不会落盘，只在本次会话内有效，界面上会写明。

## 登录方式

登录页有两个页签，默认是**用户名密码**。

### 用户名密码（默认）

走服务端 `/moment/auth/login` 换一个 30 天有效的令牌。这条接口 SDK 没有封装，
而且它返回的 `token` 走的是 `authId` 头，而 SDK 只会发 `Base-Request-Param` ——
所以这里直接用 SDK 的 `Transport` 发原始请求，再用 `chipId: ''` 建客户端。

能不能用取决于账号有没有绑过 chipId（见服务端 `app/api_common.py` 的 `authenticate`）：

| 情况 | 行为 |
| --- | --- |
| 账号**没绑** chipId | 请求头里的 chipId 留空也放行，密码登录直接可用 |
| 账号**绑了** + **是管理员** | 自动读取自己的 chipId 后登录 |
| 账号**绑了** + 非管理员 | 提示必须手动填 chipId |

「自动读取」这条路有点绕，但确实是唯一可行的：客户端 API **从不回传 chipId**
（你在后台用户列表里能看到，是因为 dashboard 拿管理员会话直接查的 `users` 表）。
所以管理员这个分支是：用同一组用户名密码登录后台会话 → 抓 `/dashboard` 页面 →
按 watchId 精确匹配出自己那一行的 chipId。全程只读自己那条记录，解析失败就退回
「请手动填」，不猜。逻辑在 `electron/main/admin-chip.ts`，依赖后台的表格结构，改版会失效。

chipId 在密码模式下是**可选**的，默认收起：绝大多数账号根本用不到，摆出来只会让人犹豫。
只有三种情况会展开——切到设备凭据模式、服务端要求补、或者用户自己点了那个链接。

密码登录的令牌在退出时会调 `/moment/auth/logout` 撤销，不让它在服务端躺满 30 天。

### 设备凭据

直接填 watchId + chipId，走 SDK 原生鉴权。芯片号在手边的账号用这个最快，不依赖任何服务端接口。

### 凭据存放

两种模式的凭据都用系统密钥（Windows DPAPI / macOS Keychain）加密后存在
`<userData>/account.json`，格式是 `core/credential.ts` 里的 v2。

**密码模式存的是两样东西**：令牌（退出时用它撤销）和设备 chipId（鉴权必需）。
这里踩过一个坑，值得记下来 —— 早期版本只存了令牌，看着没问题，因为登录当场
是用带 chipId 的凭据打的接口。但下次启动从磁盘恢复时 chipId 只能还原成空串：

- 账号**没绑**设备：空 chipId 也放行，看起来一切正常；
- 账号**绑了**设备：服务端直接 `000016`，恢复逻辑判定令牌失效 → 清掉凭据 →
  用户每次开机都得重新登录。

所以密码模式的加密载荷现在是个 JSON `{ token, chipId }`。旧格式（裸令牌字符串）
仍然能读，只是里面没有 chipId，未绑定的账号不受影响。

令牌过期（`expiresAt` 已过）时不会被强行复用，会退回登录页让你重新输。

## 能做什么

- 读：按时间倒序的动态流，游标翻页；「我发的」在本地筛选
- 写：文字、最多九张图、视频（可带封面），可挂话题与位置
- 互动：点赞（乐观更新，失败回滚）、评论、回复（渲染成「A 回复 B」）
- 管理：作者可删自己的动态与评论，删除前有行内二次确认

## 视频封面

选完视频会自动抽**第一帧**当封面（320×360，按 cover 裁满），发布器里直接能看到
这张缩略图，写着「封面：视频第一帧」。可以点「换封面」换成自己的图，或者「去掉」不传。

实现上没有引 ffmpeg —— 那会往安装包里塞几十 MB 二进制，还多一个「装不上应用」的理由。
用的是 Chromium 自带的解码：起一个隐藏窗口加载视频，把 `<video>` 画进 canvas 取 JPEG，
主进程写盘后把路径交给 SDK 的 `coverPath`。实测一个 3MB 的 mp4 抽帧约 160ms。

几个踩过的坑记在这里，改这个模块前先看：

- **别在 `executeJavaScript` 返回的 Promise 里等 `loadeddata` 事件**，隐藏窗口里它可能不来，
  调用会永久挂住；改成轮询 `readyState`。
- **别用 `requestAnimationFrame`** 等帧，隐藏窗口没有合成器，rAF 不触发。
- **别在 `loadURL` 之后再挂 `did-finish-load` 或用 `isLoading()` 轮询**，两者互相等待会死锁。
- 第一帧若是黑场淡入，会依次尝试 0 / 0.5 / 1.5 秒，第一个不纯黑的就用。
- 抽帧失败不阻断发布：封面留空，发布器里显示「未设置」，手表端显示默认图。
- 临时封面写在系统临时目录，发布结束后主进程即删除，不在用户机器上留垃圾。

## 结构

```
core/                     主进程与 TUI 共用，不碰 Electron API
  credential.ts           凭据的形状、v1/v2 兼容、过期判断（加密交给宿主）
  moment.ts               SDK 封装、SDK 动态 → 视图模型
  auth.ts                 用户名密码登录（SDK 没包的接口）与绑定状态探测
  admin-chip.ts           管理员自助读取自己的 chipId
electron/main/
  index.ts        窗口、安全策略、外链交给系统浏览器
  ipc.ts          IPC 白名单：参数收窄后再碰 SDK，错误统一翻译成中文
  cover.ts        从视频抽第一帧当封面（隐藏窗口 + canvas）
  credentials.ts  safeStorage 加密存取凭据（chipId / 令牌）
electron/preload/
  index.ts        只做转发，不做判断
src/shared/
  types.ts        主/渲染共用的契约，刻意不 import SDK 类型
src/renderer/
  styles/tokens.css   色板、字号、间距，以及设计禁令
  components/         卡片、图片网格、视频、灯箱、评论、发布器
  pages/              登录、动态流、详情、设置
tui/                    终端版（**暂停开发**，见下）
scripts/
  verify.mjs      对真实服务端跑一遍读/写链路（会自建再自删测试动态）
  shoot.mjs       用 CDP 驱动界面逐页截图，做视觉自查
```

## 终端版（暂停开发）

`tui/` 下有一套基于 ink 的终端客户端，**当前暂停**，不参与构建与发版：
`npm run tui` 只会打印一句「尚未完成」。代码保留在这里，方便以后接着做。

已经跑通的部分：登录（两种模式）、动态流、详情、点赞、评论、删除、
三档图片渲染（iTerm2 inline / Sixel / 半块字符色块）、视频解码子进程。

卡住的地方是**图片和 ink 的重绘打架**。ink 每帧用 `eraseLines` 整块重写，
Sixel 字节写进渲染树必然被擦掉；试过绝对定位回填、`<Static>` 分区都不行
（Static 只追加，滚动时会堆出重复内容）。目前唯一验证可行的做法是：
让 ink 只管上方文字区，图片用 `paintBelow()` 写在 ink 管理范围**之外**——
ink 只擦自己产出过的行数，擦不到它。这条已经在列表预览上验证通过。

音频另有一坑：FFmpeg 解出来的音频基本是 FLTP（每声道一个 float32 平面），
而 `speaker` 只吃 s16 交织。node-av 的两条转换路子都不通（`FilterAPI` 的
`process()` 恒返回 null；`AudioFrameBuffer` 构造就抛 `nbSamples` 类型错），
现在是手写 FLTP → s16 转换 + 线性重采样。

## 设计约束

暖纸质编辑部风：纸 `#FAF8F4`、墨 `#1C1B19`、砖红 `#B4472E` 是唯一的彩色。
层级靠 1px 描边和留白，不靠阴影；hover 只改颜色，不改位移、不放大、不加光晕。
这些禁令写在 `tokens.css` 顶部，改之前先读那段注释。

几个必须处理的服务端细节：

- 官方话题默认色是 `#FFFFFFCC`（为手表深色底设计），直接铺在浅色纸面上等于隐形，
  所以话题改用「下划线 + 井号」渲染，不用服务端色做文字色。
- `enableLike` 是「还能点赞」的反向标志，`false` 才表示自己已经赞过。
- 纯视频动态（type=6）的正文压根不入库，别渲染空段落。
- `/moment/search` 会忽略 `watchId`，「我发的」只能前端筛；因此那个计数在还有更早数据未加载时带 `+`。
- 服务端没有「按 id 查一条」的接口，进详情页要翻页扫描，界面上会说明这点。

## 校验

```sh
npm run typecheck    # 主进程与渲染进程两份 TS 都过
npm run build
```

对真实服务端的链路验证（凭据只从环境变量读，不入库）：

```sh
MOMENT_BASE_URL=http://127.0.0.1:8000 \
MOMENT_WATCH_ID=<watchId> \
MOMENT_CHIP_ID=<chipId> \
node scripts/verify.mjs
```
