# 第三方组件许可声明

本软件以 MIT 许可发布，全文见 [`LICENSE`](./LICENSE)。

本软件包含下列第三方组件，版权归各自的作者所有，并按各自声明的许可授权使用。
本文件是这些许可所要求的署名与声明。

---

## 一、随应用一起分发的组件

| 组件 | 版本 | 许可 | 版权所有者 |
| --- | --- | --- | --- |
| Electron | 44.9.0 | MIT | Copyright (c) Electron contributors<br>Copyright (c) 2013-2020 GitHub Inc. |
| React | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates |
| React DOM | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates |
| @caremiumos-dev/node-moment-sdk | 0.2.0 | MIT | Copyright (c) 2026 Caremium |

**Electron 内含 Chromium 与 Node.js。** 它们的完整许可随 Electron 一并提供，
见应用安装目录下的 `LICENSE` 与 `LICENSES.chromium.html`。
其中 FFmpeg 动态库（`ffmpeg.dll` / `libffmpeg.so`）以 **LGPL 2.1** 授权，
Chromium 项目以动态链接方式使用，未对源码作修改。

## 二、仅用于构建、不随应用分发的组件

| 组件 | 版本 | 许可 | 版权所有者 |
| --- | --- | --- | --- |
| TypeScript | 5.9.3 | Apache-2.0 | Copyright (c) Microsoft Corporation |
| Vite | 7.3.7 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| electron-vite | 6.0.0 | MIT | Copyright (c) 2022, Alex Wei |
| @vitejs/plugin-react | 4.7.0 | MIT | Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors |

这些工具只在打包阶段使用，不会出现在最终应用里。

## 三、终端版组件（本版本不包含）

终端版功能尚未完成，当前发布的应用中**不包含**下列组件。
如果你使用的是自行构建、启用了终端版的版本，则其中还包含：

| 组件 | 版本 | 许可 | 版权所有者 |
| --- | --- | --- | --- |
| ink | 6.8.0 | MIT | Copyright (c) Vadym Demedes<br>Copyright (c) Sindre Sorhus |
| figures | 6.1.0 | MIT | Copyright (c) Sindre Sorhus |
| sixel | 0.16.0 | MIT | Copyright (c) 2019, Joerg Breitbart |
| node-av | 6.1.1 | MIT | Copyright (c) 2023-2026 seydx |
| speaker | 0.5.5 | MIT **AND** LGPL-2.1-only | 见下 |

### speaker

`speaker` 由两部分组成，两部分许可**同时适用**：

- speaker 自身代码 —— MIT，Copyright (c) 2012 Nathan Rajlich
- mpg123 的音频输出模块 —— LGPL 2.1

**请留意**：其中 macOS 使用的后端文件 `coreaudio.c`，作者声明的是
**GPL 2**，而不是 LGPL 2.1。也就是说，在 macOS 上构建的终端版会带上
一份 GPL-2.0 的代码，其分发条件比 LGPL 更严格。

mpg123 的完整许可条文位于该组件源码包内的 `deps/mpg123/COPYING`。
mpg123 项目自述如下：

> mpg123 is licensed under the GNU General Lesser Public License, version 2.1,
> and in parts under the GNU General Public License, version 2.

若你分发含 speaker 的二进制，需随包提供 mpg123 的源码，或提供书面获取方式
（written offer），并保留上述 `COPYING` 文件。

### node-av 与 FFmpeg

`node-av` 自身是 MIT，但它在安装时会下载一份 FFmpeg 二进制。
FFmpeg 的许可取决于该二进制的构建配置：

| 构建配置 | 许可 |
| --- | --- |
| `--disable-gpl`（Jellyfin 构建） | LGPL |
| `--enable-gpl` | GPL 2.0 或更高 |
| `--enable-gpl --enable-version3` | GPL 3.0 |

本版本未包含该二进制。如果你自行构建终端版，可运行 `ffmpeg -version`，
查看输出中的 `configuration` 一行来确认许可。

FFmpeg 许可说明见 <https://ffmpeg.org/legal.html>。

---

## 附：MIT 许可全文

上表中标注 MIT 的组件，均按以下条款授权：

```
MIT License

［版权行见上方表格中各组件的「版权所有者」一列］

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
```

各组件的具体版权行见上方表格。Apache-2.0、LGPL 2.1、GPL 2.0 的完整条文，
随对应组件一起提供（位于其安装目录下的 `LICENSE` / `COPYING` 文件）。
