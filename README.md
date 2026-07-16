# Douyin Live Pure PiP

一个用于抖音直播网页版的 Tampermonkey 脚本。它会在页面右下角显示一个按钮，把直播区域移入 Chromium 的 Document Picture-in-Picture 窗口，并尽量保持直播持续播放。

## 功能

- 一键将 `.pip-anchor` 对应的直播区域移入 Document PiP 窗口。
- 关闭 PiP 后自动把直播区域放回原页面位置。
- 启用纯净直播样式，隐藏导航、头部、底部栏、礼物特效、礼物托盘、商品卡、点赞层等干扰元素。
- 自动尝试切换到清晰度列表中的第一个选项，通常是“原画”。
- 伪装页面始终可见，减少后台或长时间无操作导致的暂停。
- 监听“长时间无操作，已暂停播放”弹窗，尝试自动关闭并恢复播放。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或兼容的 userscript 管理器。
2. 打开脚本 raw 地址：
   <https://raw.githubusercontent.com/YPJCoding/douyin-live-pure-pip/main/douyin-live-pure-pip.user.js>
3. 在 Tampermonkey 中确认安装。
4. 打开 `https://live.douyin.com/*` 直播间，点击右下角的“打开 PiP”按钮。

## 兼容性

这个脚本依赖 Chromium 系浏览器的 Document Picture-in-Picture API。Chrome、Edge 等新版本 Chromium 浏览器更可能可用；Firefox 和 Safari 通常不支持这个 API。

PiP 窗口尺寸由浏览器控制，脚本传入的宽高只是建议值，浏览器可能根据屏幕、系统限制或历史窗口尺寸进行调整。

## 注意

- 脚本会移动真实 DOM 节点，不是截图或克隆。直播区域在 PiP 打开期间会暂时离开原页面。
- 抖音直播页面 DOM 和 React 结构可能变化，自动清晰度、纯净样式和防暂停逻辑都可能需要随站点更新调整。
- 自动清晰度当前点击 `[data-e2e="quality-selector"] > :first-child`，如果抖音调整清晰度列表顺序，需要更新选择器。

## 致谢

实现思路参考了以下开源 userscript：

- [Picture-in-Picture Anything](https://github.com/umutseven92/picture-in-picture-anything)：Document PiP 和移动 DOM 元素的思路。
- [pure-live](https://github.com/ljezio/pure-live)：抖音直播纯净样式和自动清晰度选择思路。
- [Douyin-Anti-Pause](https://github.com/xuanli493/Douyin-Anti-Pause)：页面可见性伪装思路。
- [WhiteSevs/TamperMonkeyScript](https://github.com/WhiteSevs/TamperMonkeyScript)：长时间无操作暂停弹窗处理思路。

## License

MIT
