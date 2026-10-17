---
title: "Ability——授予记录、执行实例与生命周期"
description: ""
publishedAt: 2026-10-14
tags: ["Unreal Engine","Ability System","source-reading"]
draft: true
---



| 对象                    | 表示什么                          | 谁拥有/管理                     | 火球案例                               |
| ----------------------- | --------------------------------- | ------------------------------- | -------------------------------------- |
| Ability 类与 CDO        | 技能类型及默认配置                | UClass 与引擎对象系统           | `GA_Fireball` 的默认标签、Cost/冷却类  |
| `FGameplayAbilitySpec`  | 某 ASC 获得该能力的一份记录       | ASC 的 `ActivatableAbilities`   | 玩家 A 的 3 级火球、输入标识和 Handle  |
| Ability 执行对象        | 执行流程及该实例的临时状态        | 由 ASC 按 InstancingPolicy 管理 | 本次吟唱的目标、任务、阶段             |
| `FGameplayEffectSpec`   | 一次效果应用的参数与捕获数据      | Spec Handle 或活动效果等持有    | 本次火球的等级、伤害值、来源和命中信息 |
| `FActiveGameplayEffect` | 已加入目标容器的持续/预测效果记录 | 目标 ASC 的效果容器             | 冷却起始时间、持续时间、层数与移除句柄 |
