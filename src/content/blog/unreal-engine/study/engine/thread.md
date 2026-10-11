---
title: "游戏引擎多线程——线程分工、任务系统与同步"
description: ""
publishedAt: 2026-10-11
tags: ["Unreal Engine","Thread"]
draft: false
---

个人理解，按照**初级程序员**的标准，记录自己的学习过程。

## 1. 为什么引擎需要多线程

60 FPS 的单帧预算约为 16.67 ms，120 FPS 约为 8.33 ms。角色逻辑、动画、物理、资源加载、渲染准备都挤在一个线程里，串行耗时很容易超过预算。

> \[ \text{单帧时间预算}=\frac{1000\text{ ms}}{\text{FPS}} \]

假设某一阶段有三项纯计算：

```
单线程：A 4ms → B 4ms → C 4ms → 汇总 1ms，约 13ms

并行：Worker 1：A 4ms ┐
     Worker 2：B 4ms ├→ 汇总 1ms，理想约 5ms
     Worker 3：C 4ms ┘
```

如果 B 必须读取 A 的结果，C 必须读取 B 的结果，那么依然是 `A → B → C`。把它们放到三个线程，不会消除依赖。

### 四个概念

| 概念 | 直接理解                                   | 引擎例子                             |
| ---- | ------------------------------------------ | ------------------------------------ |
| 线程 | 操作系统进行 CPU 调度的基本单位            | Game Thread、Render Thread、Worker   |
| 任务 | 一段待执行的工作，本身不等于线程           | 将一批角色的动画计算拆分为多个任务   |
| 并发 | 多项工作在同一时间段内推进，不要求同时执行 | 一个核心在多个线程之间切换           |
| 并行 | 多项工作在同一时刻真正同时执行             | 多核 CPU 同时执行游戏线程与渲染线程  |
| 异步 | 发起后不用立即等结果，可以继续做别的事     | 异步加载资源，完成后通过回调处理结果 |

异步是调用与完成的关系，多线程是执行方式，两者不能画等号。

线程都有自己的调用栈和寄存器状态。同一个进程里的线程它们通常是共享内存的。对于同一个指针，复制到另一个线程，它们指向的还是相同的地址，内容是相同的。 

### UE 中通常有哪些线程

| 线程或执行域                                                               | 主要职责                                           | 说明                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| Game Thread                                                                | World、Actor、常规 Gameplay、多数 UObject/UMG 操作 | 普通游戏对象的业务读写默认放这里            |
| Render Thread                                                              | 消费渲染侧数据，组织渲染工作                       | 通过渲染接口交接数据，不能随意读 Actor 状态 |
| RHI Thread（Render Hardware Interface Thread，渲染硬件接口线程）（启用时） | 执行部分 RHI 命令提交工作                          | 受平台、RHI 和配置影响，不保证总有独立线程  |
| 任务 Worker                                                                | 执行任务系统中可调度的工作                         | 适合有界、独立的计算，避免长期阻塞          |
| Queued Thread Pool                                                         | 消费排队的后台工作                                 | 与任务系统 Worker 不应视作同一个池          |
| 加载、音频等线程                                                           | 特定系统的专用或异步工作                           | 使用系统提供的 API，具体拆分依平台和配置    |
| GPU                                                                        | 执行提交后的图形/计算命令                          | GPU 是处理器，不是一个 C++ 工作线程         |

## 2. 一帧发生了什么？

常见的渲染链：

```
Game Thread：更新游戏状态，产生渲染更新
      ↓ 提交数据/命令
Render Thread：组织渲染命令
      ↓
RHI 执行/提交（可能有独立 RHI Thread）
      ↓
GPU：执行图形工作
```

真实时间还会受到同步点、GPU 呈现和帧率限制的影响，因此单帧时间预算不可以简单地相加。 

> 同步点是指多个线程或执行单元之间必须等待某项工作的完成才会继续执行。 
>
> ![img](data:image/svg+xml;charset=utf-8,%3Csvg%20font-family%3D%22-apple-system-body%2C%20ui-sans-serif%2C%20-apple-system%2C%20system-ui%2C%20%26quot%3BSegoe%20UI%26quot%3B%2C%20Helvetica%2C%20%26quot%3BApple%20Color%20Emoji%26quot%3B%2C%20Arial%2C%20sans-serif%2C%20%26quot%3BSegoe%20UI%20Emoji%26quot%3B%2C%20%26quot%3BSegoe%20UI%20Symbol%26quot%3B%22%20font-weight%3D%22400%22%20data-d-component%3D%22svg%22%20fill%3D%22currentColor%22%20style%3D%22color%3Argb(13%2C%2013%2C%2013)%22%20viewBox%3D%220%200%20340%20190%22%20width%3D%22100%25%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ctext%20x%3D%228%22%20y%3D%2246%22%20fill%3D%22currentColor%22%20font-size%3D%2211%22%20font-weight%3D%22600%22%3EGame%20Thread%3C%2Ftext%3E%3Ctext%20x%3D%228%22%20y%3D%22120%22%20fill%3D%22currentColor%22%20font-size%3D%2211%22%20font-weight%3D%22600%22%3ERender%20Thread%3C%2Ftext%3E%3Crect%20x%3D%22111%22%20y%3D%2232%22%20width%3D%2265%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%2316A34A%22%20opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22176%22%20y%3D%2232%22%20width%3D%2281%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%23EAB308%22%20opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22257%22%20y%3D%2232%22%20width%3D%2269%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%2316A34A%22%20opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22111%22%20y%3D%22106%22%20width%3D%22146%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%230D9488%22%20opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22257%22%20y%3D%22106%22%20width%3D%2269%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%2364748B%22%20opacity%3D%22.4%22%2F%3E%3Cg%20font-size%3D%2210%22%20fill%3D%22%23fff%22%20text-anchor%3D%22middle%22%3E%3Ctext%20x%3D%22143%22%20y%3D%2247%22%3E%E6%89%A7%E8%A1%8C%E9%80%BB%E8%BE%91%3C%2Ftext%3E%3Ctext%20x%3D%22216%22%20y%3D%2247%22%20fill%3D%22%2327272A%22%3E%E7%AD%89%E5%BE%85%3C%2Ftext%3E%3Ctext%20x%3D%22291%22%20y%3D%2247%22%3E%E7%BB%A7%E7%BB%AD%E6%89%A7%E8%A1%8C%3C%2Ftext%3E%3Ctext%20x%3D%22183%22%20y%3D%22121%22%3E%E6%89%A7%E8%A1%8C%E6%B8%B2%E6%9F%93%E4%BB%BB%E5%8A%A1%3C%2Ftext%3E%3C%2Fg%3E%3Cline%20x1%3D%22257%22%20y1%3D%2225%22%20x2%3D%22257%22%20y2%3D%22140%22%20stroke%3D%22%23F59E0B%22%20stroke-dasharray%3D%224%203%22%20stroke-width%3D%221.5%22%2F%3E%3Ctext%20x%3D%22257%22%20y%3D%2217%22%20font-size%3D%2210%22%20fill%3D%22%23D97706%22%20text-anchor%3D%22middle%22%3E%E5%90%8C%E6%AD%A5%E5%AE%8C%E6%88%90%3C%2Ftext%3E%3Ctext%20x%3D%22111%22%20y%3D%22172%22%20fill%3D%22currentColor%22%20opacity%3D%22.65%22%20font-size%3D%2210%22%3E%E6%97%B6%E9%97%B4%20%E2%86%92%3C%2Ftext%3E%3Cpath%20d%3D%22M147%20169%20H326%22%20stroke%3D%22currentColor%22%20opacity%3D%22.4%22%20stroke-width%3D%221.2%22%2F%3E%3Cpath%20d%3D%22M321%20165%20L327%20169%20L321%20173%22%20stroke%3D%22currentColor%22%20opacity%3D%22.4%22%20fill%3D%22none%22%2F%3E%3C%2Fsvg%3E)

### 为什么不直接让渲染线程读取 Actor

例如游戏线程可能正在修改某个 Actor 的位置或者正在销毁某个 Actor，但若此时渲染线程它使用的是同一份对象的状态，那么就会出现竞态的问题。

| 时刻 | 游戏线程     | 渲染线程     |
| ---- | ------------ | ------------ |
| T1   | 写入 X = 500 | —            |
| T2   | —            | 读取 X = 500 |
| T3   | —            | 读取 Y = 200 |
| T4   | —            | 读取 Z = 300 |

因此为了解决这个问题，最好的方式是复制一份数据快照给另一个县城。 

## 3. TaskGraph 与 UE::Tasks

[Epic 官方文档](https://dev.epicgames.com/documentation/unreal-engine/tasks-systems-in-unreal-engine?lang=en-US)明确将 `UE::Tasks`（Tasks System）定位为对传统 `TaskGraph` 的改进。两者在默认新后端下共享底层 LowLevelTasks 调度设施。

**任务系统**是一个作业管理器，能够异步执行你的游戏代码。它支持构建和运行依赖任务的有向无环图。

### Worker 怎样找到工作

调度器会维护队列， Worker 会在空闲的时候从其他队列里面去寻找是否有可执行的任务，这样就可以避免出现空闲的情况，充分利用资源。 

```cpp
while(
    TryExecuteTaskFrom<FSchedulerTls::FLocalQueueType, &FSchedulerTls::FLocalQueueType::Dequeue, false>(WorkerEvent, WorkerLocalQueue, OutOfWork, bPermitBackgroundWork)
   ||
   TryExecuteTaskFrom<FSchedulerTls::FLocalQueueType, &FSchedulerTls::FLocalQueueType::DequeueSteal, false>(WorkerEvent, WorkerLocalQueue, OutOfWork, bPermitBackgroundWork))
```

### 依赖示例

```CPP
#include "Tasks/Task.h"

auto TaskA = UE::Tasks::Launch(UE_SOURCE_LOCATION, []()
{
    return 10;
});

auto TaskB = UE::Tasks::Launch(UE_SOURCE_LOCATION, []()
{
    return 20;
});

auto CombinedTask = UE::Tasks::Launch(
    UE_SOURCE_LOCATION,
    [TaskA, TaskB]() mutable
    {
        return TaskA.GetResult() + TaskB.GetResult();
    },
    UE::Tasks::Prerequisites(TaskA, TaskB));
```

A、B 可以独立执行，`UE::Tasks::Prerequisites(TaskA, TaskB)` 表示 CombinedTask 在两者完成后才具备执行条件。

