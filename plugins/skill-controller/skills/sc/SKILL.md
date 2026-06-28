---
name: sc
description: 用于打开 Skill Controller 可视化面板，查看、启用、禁用、删除、重命名、总结、个性化和统计 Codex skills；当用户说 sc、要弹出技能控制窗口、查看技能清单或管理某个 skill 时使用。
---

# Skill Controller

当用户说 `sc`，优先打开插件根目录里的 `../../skill-controller-mockup.html?v=personalization`，并把当前浏览器切到这个面板。

如果预览服务器已经在运行，就直接复用现有标签页；如果没有，就先启动同目录的 `../../preview-server.mjs` 再打开页面。不要重复开多个控制台窗口。

## 操作要点

- 默认用中文解释 skill 的区别、用途和限制。
- 选中某个 skill 后，右侧详情要跟随到该 skill。
- 对能修改的字段直接保存，对被锁定的字段直接说明原因。
- 用户只说 `sc` 时，优先把窗口弹出来，不要先讲流程。
