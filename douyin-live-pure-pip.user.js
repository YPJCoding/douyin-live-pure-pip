// ==UserScript==
// @name         Douyin Live Pure PiP
// @name:zh-CN   抖音直播纯净 PiP
// @namespace    https://github.com/YPJCoding/douyin-live-pure-pip
// @version      0.3.0
// @description  Move Douyin Live into a clean Document Picture-in-Picture window and keep playback active.
// @description:zh-CN 将抖音直播移入纯净 Document PiP 窗口，并尽量保持直播持续播放。
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
  const MAX_PIP_WIDTH = 720;
  const MAX_PIP_HEIGHT = 720;
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

  installVisibilityGuard(window);

  function init() {
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
    addPureLiveStyles(document);

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

    installVisibilityGuard(pipWindow);
    cleanupPipAutoPauseGuard?.();
    cleanupPipAutoPauseGuard = installAutoPauseGuard(pipWindow.document);

    preparePipDocument(pipWindow.document, target);
    pipWindow.document.body.appendChild(target);
    cleanupPipAutoHighestQuality?.();
    cleanupPipAutoHighestQuality = installAutoHighestQuality(pipWindow.document);
    dispatchResize();

    pipWindow.addEventListener(
      "pagehide",
      () => {
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
    return {
      parent: element.parentElement,
      previousSibling: element.previousSibling,
      nextSibling: element.nextSibling,
    };
  }

  function restoreTarget(element, restorePoint) {
    const { parent, previousSibling, nextSibling } = restorePoint;

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

    const timerId = rootWindow.setInterval(check, 3000);
    check();

    return () => {
      observer.disconnect();
      rootWindow.clearInterval(timerId);
    };
  }

  function getPauseDialogCandidates(rootDocument) {
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
      switched = true;
      return true;
    };

    const observeControl = (control) => {
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

    const timeoutId = rootWindow.setTimeout(() => {
      disconnectors.splice(0).forEach((disconnect) => disconnect());
    }, 10000);

    return () => {
      rootWindow.clearTimeout(timeoutId);
      disconnectors.splice(0).forEach((disconnect) => disconnect());
    };
  }

  if (document.body) {
    init();
  } else {
    window.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
