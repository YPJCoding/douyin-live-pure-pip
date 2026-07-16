// ==UserScript==
// @name         抖音直播纯净 PiP
// @name:en      Douyin Live Pure PiP
// @namespace    https://github.com/YPJCoding/douyin-live-pure-pip
// @version      0.3.1
// @description  将抖音直播移入纯净 Document PiP 窗口，并尽量保持直播持续播放。
// @description:en Move Douyin Live into a clean Document Picture-in-Picture window and keep playback active.
// @author       YPJCoding
// @license      MIT
// @homepageURL  https://github.com/YPJCoding/douyin-live-pure-pip
// @supportURL   https://github.com/YPJCoding/douyin-live-pure-pip/issues
// @source       https://github.com/YPJCoding/douyin-live-pure-pip
// @match        https://live.douyin.com/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/YPJCoding/douyin-live-pure-pip/main/douyin-live-pure-pip.user.js
// @updateURL    https://raw.githubusercontent.com/YPJCoding/douyin-live-pure-pip/main/douyin-live-pure-pip.user.js
// ==/UserScript==

(function () {
  "use strict";

  const TARGET_SELECTOR = ".pip-anchor";
  const BUTTON_ID = "__douyin-live-pure-pip-button";
  const PURE_LIVE_STYLE_ID = "__douyin-live-pure-pip-style";
  // Document PiP 的宽高只是浏览器建议值，实际窗口大小可能被浏览器限制或记忆。
  const MAX_PIP_WIDTH = 720;
  const MAX_PIP_HEIGHT = 720;
  // 纯净样式来自 pure-live 的抖音直播思路：隐藏干扰层，只保留直播主体。
  const PURE_LIVE_CSS = `
    #douyin-navigation,
    #douyin-header,
    #RightBackgroundLayout,
    #BottomLayout,
    #HeaderLayout,
    #GiftEffectLayout,
    #GiftTrayLayout,
    #EcmoCardLayout,
    #ShortTouchLayout,
    #LikeLayout,
    #room_info_bar,
    .ShortTouchBigCard,
    .douyin-player-controls-inner + div,
    .chatroom_close {
      display: none !important;
    }

    #LeftBackgroundLayout,
    #ContainerBackgroundLayout {
      width: 100vw !important;
      height: 100vh !important;
      margin: 0 !important;
    }

    .__livingPlayer__ {
      padding: 0 !important;
    }
  `;

  let activePipWindow = null;
  let restoreElement = null;
  let cleanupMainAutoPauseGuard = null;
  let cleanupPipAutoPauseGuard = null;
  let cleanupMainAutoHighestQuality = null;
  let cleanupPipAutoHighestQuality = null;

  // 尽早伪装页面始终可见，减少抖音基于 hidden/visibilityState 的暂停判断。
  installVisibilityGuard(window);

  function init() {
    // 抖音是 SPA，脚本可能因为页面恢复或管理器重载重复执行；按钮存在就不重复初始化。
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "打开 PiP";
    button.addEventListener("click", openTargetInPip);

    Object.assign(button.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      padding: "8px 12px",
      border: "1px solid rgba(255, 255, 255, 0.22)",
      borderRadius: "6px",
      background: "rgba(18, 18, 18, 0.88)",
      color: "#fff",
      fontSize: "14px",
      lineHeight: "20px",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      cursor: "pointer",
      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
    });

    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(38, 38, 38, 0.94)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "rgba(18, 18, 18, 0.88)";
    });

    document.body.appendChild(button);
    // 主页面先应用纯净样式，用户即使不打开 PiP 也能获得较干净的直播页面。
    addPureLiveStyles(document);

    // 主页面的 watcher 持续存在；PiP 内的 watcher 会随 PiP 关闭单独清理。
    if (!cleanupMainAutoPauseGuard) {
      cleanupMainAutoPauseGuard = installAutoPauseGuard(document);
    }
    if (!cleanupMainAutoHighestQuality) {
      cleanupMainAutoHighestQuality = installAutoHighestQuality(document);
    }
  }

  async function openTargetInPip() {
    if (!("documentPictureInPicture" in window)) {
      alert("当前浏览器不支持 Document Picture-in-Picture API。");
      return;
    }

    if (activePipWindow && !activePipWindow.closed) {
      activePipWindow.focus();
      return;
    }

    const target = document.querySelector(TARGET_SELECTOR);

    if (!(target instanceof HTMLElement)) {
      alert(`未找到目标元素：${TARGET_SELECTOR}`);
      return;
    }

    const restorePoint = createRestorePoint(target);
    // 基于目标元素当前比例请求 PiP 尺寸，避免固定比例裁切直播画面。
    const pipSize = getPipSize(target);

    let pipWindow;
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow(pipSize);
    } catch (error) {
      console.error("[Douyin Live PiP] Failed to open PiP window:", error);
      return;
    }

    activePipWindow = pipWindow;
    restoreElement = () => restoreTarget(target, restorePoint);

    // PiP 是独立的 document/window，防暂停和画质逻辑需要在 PiP 内再装一份。
    installVisibilityGuard(pipWindow);
    cleanupPipAutoPauseGuard?.();
    cleanupPipAutoPauseGuard = installAutoPauseGuard(pipWindow.document);

    preparePipDocument(pipWindow.document, target);
    // 这里移动的是真实 DOM 节点，不是 clone；关闭 PiP 时会按 restorePoint 放回原位置。
    pipWindow.document.body.appendChild(target);
    cleanupPipAutoHighestQuality?.();
    cleanupPipAutoHighestQuality = installAutoHighestQuality(pipWindow.document);
    dispatchResize();

    pipWindow.addEventListener(
      "pagehide",
      () => {
        // pagehide 是 Document PiP 关闭时最可靠的恢复点。
        if (restoreElement) {
          restoreElement();
          restoreElement = null;
        }
        cleanupPipAutoPauseGuard?.();
        cleanupPipAutoPauseGuard = null;
        cleanupPipAutoHighestQuality?.();
        cleanupPipAutoHighestQuality = null;
        activePipWindow = null;
        dispatchResize();
      },
      { once: true },
    );
  }

  function createRestorePoint(element) {
    // 保存相邻节点比只保存 parent 更稳，能尽量恢复到原来的 DOM 顺序。
    return {
      parent: element.parentElement,
      previousSibling: element.previousSibling,
      nextSibling: element.nextSibling,
    };
  }

  function restoreTarget(element, restorePoint) {
    const { parent, previousSibling, nextSibling } = restorePoint;

    // 优先根据相邻节点恢复；如果相邻节点已被页面重渲染移除，再退回 append 到原父节点。
    if (previousSibling && previousSibling.parentNode) {
      previousSibling.after(element);
      return;
    }

    if (nextSibling && nextSibling.parentNode) {
      nextSibling.before(element);
      return;
    }

    if (parent) {
      parent.appendChild(element);
    }
  }

  function getPipSize(element) {
    const rect = element.getBoundingClientRect();
    const width = rect.width || window.innerWidth || 500;
    const height = rect.height || window.innerHeight || 500;
    const aspectRatio = width / height || 1;

    // 保持原比例，把较长边限制在 720，避免初次打开 PiP 请求过大的窗口。
    if (width >= height) {
      const pipWidth = Math.min(width, MAX_PIP_WIDTH);
      return {
        width: Math.round(pipWidth),
        height: Math.round(pipWidth / aspectRatio),
      };
    }

    const pipHeight = Math.min(height, MAX_PIP_HEIGHT);
    return {
      width: Math.round(pipHeight * aspectRatio),
      height: Math.round(pipHeight),
    };
  }

  function preparePipDocument(pipDocument, target) {
    // PiP 文档不继承原页面样式，需要复制样式表并补上 html/body 的关键样式。
    copyStyleSheets(document, pipDocument);
    addPureLiveStyles(pipDocument);

    pipDocument.documentElement.style.cssText = getRelevantStyleText(
      document.documentElement,
    );
    pipDocument.body.style.cssText = getRelevantStyleText(document.body);

    Object.assign(pipDocument.body.style, {
      margin: "0",
      overflow: "hidden",
      background: getInheritedBackgroundColor(target),
    });
  }

  function copyStyleSheets(sourceDocument, targetDocument) {
    for (const styleSheet of sourceDocument.styleSheets) {
      try {
        const rules = Array.from(styleSheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
        const style = targetDocument.createElement("style");
        style.textContent = rules;
        targetDocument.head.appendChild(style);
      } catch (_error) {
        // 跨域 stylesheet 不能读 cssRules，退回到 link 标签引用原样式地址。
        if (!styleSheet.href) {
          continue;
        }

        const link = targetDocument.createElement("link");
        link.rel = "stylesheet";
        link.type = styleSheet.type || "text/css";
        link.media = styleSheet.media ? styleSheet.media.toString() : "";
        link.href = styleSheet.href;
        targetDocument.head.appendChild(link);
      }
    }
  }

  function getRelevantStyleText(element) {
    // 只复制根元素上会影响整体观感的样式，避免把页面布局约束强行带进 PiP。
    const styles = window.getComputedStyle(element);
    const properties = [
      "background-color",
      "color",
      "font-size",
      "font-family",
      "font-weight",
      "font-style",
      "color-scheme",
    ];

    return properties
      .map((property) => {
        const value = styles.getPropertyValue(property);
        return value && value !== "none" ? `${property}: ${value};` : "";
      })
      .join("");
  }

  function getInheritedBackgroundColor(element) {
    let current = element;

    // 目标元素背景透明时向父级寻找真实背景色，防止 PiP body 变成默认白底。
    while (current) {
      const backgroundColor = window.getComputedStyle(current).backgroundColor;
      if (
        backgroundColor &&
        backgroundColor !== "transparent" &&
        backgroundColor !== "rgba(0, 0, 0, 0)"
      ) {
        return backgroundColor;
      }
      current = current.parentElement;
    }

    return "#000";
  }

  function dispatchResize() {
    window.dispatchEvent(new Event("resize"));
  }

  function addPureLiveStyles(rootDocument) {
    // 同一个 document 只注入一次，避免 PiP 多次打开时累积重复 style。
    if (rootDocument.getElementById(PURE_LIVE_STYLE_ID)) {
      return;
    }

    const style = rootDocument.createElement("style");
    style.id = PURE_LIVE_STYLE_ID;
    style.textContent = PURE_LIVE_CSS;
    (rootDocument.head || rootDocument.documentElement).appendChild(style);
  }

  function installVisibilityGuard(targetWindow) {
    try {
      // @grant none 下脚本运行在页面上下文，覆盖原型能影响站点自己的可见性读取。
      Object.defineProperty(targetWindow.Document.prototype, "hidden", {
        configurable: true,
        get: () => false,
      });

      Object.defineProperty(targetWindow.Document.prototype, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });

      targetWindow.document.hasFocus = () => true;
    } catch (error) {
      console.warn("[Douyin Live PiP] Visibility guard failed:", error);
    }
  }

  function installAutoPauseGuard(rootDocument) {
    const rootWindow = rootDocument.defaultView || window;
    const root = rootDocument.body || rootDocument.documentElement;

    if (!root) {
      return () => {};
    }

    let isChecking = false;
    const check = () => {
      // MutationObserver 和定时器可能同时触发，简单加锁避免重复处理同一个弹窗。
      if (isChecking) {
        return;
      }

      isChecking = true;
      try {
        const candidates = getPauseDialogCandidates(rootDocument);

        for (const node of candidates) {
          if (!(node instanceof rootWindow.HTMLElement)) {
            continue;
          }

          const text = node.textContent || "";
          if (!text.includes("长时间无操作") || !text.includes("暂停播放")) {
            continue;
          }

          // 先尝试点击继续/关闭按钮；找不到按钮时再移除弹窗节点兜底。
          const clickable = findClickableClose(node);
          if (clickable) {
            clickable.click();
          } else {
            node.remove();
          }

          resumeVideos(rootDocument);
          if (activePipWindow && !activePipWindow.closed) {
            resumeVideos(activePipWindow.document);
          }
        }
      } finally {
        isChecking = false;
      }
    };

    const observer = new rootWindow.MutationObserver(check);
    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    // 定时器是兜底：有些弹窗可能不是通过 childList 变化触发，或 observer 错过了时机。
    const timerId = rootWindow.setInterval(check, 3000);
    check();

    return () => {
      observer.disconnect();
      rootWindow.clearInterval(timerId);
    };
  }

  function getPauseDialogCandidates(rootDocument) {
    // 抖音暂停提示可能挂在不同容器里，这里只扫常见弹窗/提示区域，避免遍历全页面。
    const selectors = [
      "body > div[elementtiming='element-timing']",
      'body > div:not([id="root"]):not(:empty)',
      "#TipsLayout > div",
      "[role='dialog']",
      "[class*='modal']",
      "[class*='Modal']",
      "[class*='toast']",
      "[class*='Toast']",
    ];

    return Array.from(
      new Set(selectors.flatMap((selector) => queryAll(rootDocument, selector))),
    );
  }

  function queryAll(rootDocument, selector) {
    try {
      return Array.from(rootDocument.querySelectorAll(selector));
    } catch (_error) {
      return [];
    }
  }

  function findClickableClose(node) {
    // PiP 里的 HTMLElement 属于 pipWindow，不能用主窗口的 HTMLElement 做 instanceof。
    const nodeWindow = node.ownerDocument.defaultView || window;
    const clickables = Array.from(
      node.querySelectorAll(
        [
          "button",
          "[role='button']",
          "[aria-label*='关闭']",
          "[aria-label*='继续']",
          "[class*='close']",
          "[class*='Close']",
        ].join(","),
      ),
    ).filter((element) => element instanceof nodeWindow.HTMLElement);

    return (
      clickables.find((element) => {
        const text = element.textContent || "";
        const ariaLabel = element.getAttribute("aria-label") || "";
        return (
          text.includes("继续") ||
          text.includes("播放") ||
          text.includes("确定") ||
          text.includes("关闭") ||
          ariaLabel.includes("继续") ||
          ariaLabel.includes("关闭")
        );
      }) || clickables[0]
    );
  }

  function resumeVideos(rootDocument) {
    // 关闭弹窗后补一次 play；失败通常是浏览器策略或播放器状态限制，静默忽略。
    rootDocument.querySelectorAll("video").forEach((video) => {
      if (!video.paused) {
        return;
      }

      video.play().catch(() => {});
    });
  }

  function installAutoHighestQuality(rootDocument) {
    const rootWindow = rootDocument.defaultView || window;
    const root = rootDocument.documentElement;
    const disconnectors = [];
    let switched = false;

    if (!root) {
      return () => {};
    }

    const trySwitchQuality = () => {
      if (switched) {
        return true;
      }

      const qualityPlugin = rootDocument.querySelector(
        ".QualitySwitchNewPlugin",
      );
      const qualityOption = qualityPlugin?.querySelector(
        '[data-e2e="quality-selector"] > :first-child',
      );

      if (!qualityOption) {
        return false;
      }

      qualityOption.click();
      // 当前抖音清晰度列表第一个通常是“原画”；如果站点改顺序，只需要改上面的 selector。
      switched = true;
      return true;
    };

    const observeControl = (control) => {
      // 如果控件已经存在就立即尝试；否则监听控件内部挂载清晰度菜单。
      if (!control || trySwitchQuality()) {
        return;
      }

      const controlObserver = new rootWindow.MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof rootWindow.HTMLElement)) {
              continue;
            }

            if (
              node.className?.toString().includes("QualitySwitchNewPlugin") ||
              node.querySelector?.(".QualitySwitchNewPlugin")
            ) {
              if (trySwitchQuality()) {
                controlObserver.disconnect();
                return;
              }
            }
          }
        }
      });

      controlObserver.observe(control, {
        childList: true,
        subtree: true,
      });
      disconnectors.push(() => controlObserver.disconnect());
    };

    const existingControl = rootDocument.querySelector(
      ".douyin-player-controls-right",
    );
    observeControl(existingControl);

    if (!existingControl) {
      // 控制栏可能晚于脚本加载出现，所以先监听 documentElement 等待它挂载。
      const rootObserver = new rootWindow.MutationObserver(() => {
        const control = rootDocument.querySelector(
          ".douyin-player-controls-right",
        );
        if (!control) {
          return;
        }

        rootObserver.disconnect();
        observeControl(control);
      });

      rootObserver.observe(root, {
        childList: true,
        subtree: true,
      });
      disconnectors.push(() => rootObserver.disconnect());
    }

    // 自动清晰度只需要在页面加载或 PiP 打开后的短时间内尝试，避免长期 observer。
    const timeoutId = rootWindow.setTimeout(() => {
      disconnectors.splice(0).forEach((disconnect) => disconnect());
    }, 10000);

    return () => {
      rootWindow.clearTimeout(timeoutId);
      disconnectors.splice(0).forEach((disconnect) => disconnect());
    };
  }

  // document-start 时 body 可能还不存在；等 DOMContentLoaded 后再挂按钮和 DOM watcher。
  if (document.body) {
    init();
  } else {
    window.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
