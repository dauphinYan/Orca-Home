---
title: "游戏引擎多线程——线程分工、任务系统与同步"
description: ""
publishedAt: 2026-10-11
tags: ["Unreal Engine","Thread","source-reading"]
draft: false
---

个人理解，按照**初级程序员**的标准，记录自己的学习过程。

## 1. 为什么引擎需要多线程

60 FPS 的单帧预算约为 16.67 ms，120 FPS 约为 8.33 ms。角色逻辑、动画、物理、资源加载、渲染准备都挤在一个线程里，串行耗时很容易超过预算。

> $$
> \text{单帧时间预算}=\frac{1000\text{ ms}}{\text{FPS}}
> $$

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

## 3. 常用 API 使用

| API                             | 典型使用场景             | 具体例子                                             |
| ------------------------------- | ------------------------ | ---------------------------------------------------- |
| `UE::Tasks::Launch`             | 独立计算、任务依赖       | 后台计算大量敌人的威胁评分，再根据结果计算目标优先级 |
| `AsyncTask(GameThread, ...)`    | 切换到游戏线程           | 后台完成寻路数据计算后，回到游戏线程修改 Actor 状态  |
| `AsyncTask(AnyThread, ...)`     | 简单后台任务             | 后台统计一批纯 C++ 战斗日志数据，不需要返回值        |
| `Async(ThreadPool, ...)`        | 后台计算并取得结果       | 后台计算装备属性评分，通过 `TFuture` 获取结果        |
| `ParallelFor`                   | 大量独立、相似的计算     | 同时计算 1000 个敌人到玩家的距离平方                 |
| `FRunnable` + `FRunnableThread` | 长时间持续运行的专用线程 | 建立一个持续接收外部 TCP 数据的网络监听线程          |
| 引擎专用异步 API                | 引擎系统提供的异步操作   | 通过 `FStreamableManager` 异步加载角色模型和动画资源 |

### TaskGraph 与 UE::Tasks

[Epic 官方文档](https://dev.epicgames.com/documentation/unreal-engine/tasks-systems-in-unreal-engine?lang=en-US)明确将 `UE::Tasks`（Tasks System）定位为对传统 `TaskGraph` 的改进。两者在默认新后端下共享底层 LowLevelTasks 调度设施。

**任务系统**是一个作业管理器，能够异步执行你的游戏代码。它支持构建和运行依赖任务的有向无环图。

#### Worker 怎样找到工作

调度器会维护队列， Worker 会在空闲的时候从其他队列里面去寻找是否有可执行的任务，这样就可以避免出现空闲的情况，充分利用资源。 

```cpp
while(
    TryExecuteTaskFrom<FSchedulerTls::FLocalQueueType, &FSchedulerTls::FLocalQueueType::Dequeue, false>(WorkerEvent, WorkerLocalQueue, OutOfWork, bPermitBackgroundWork)
   ||
   TryExecuteTaskFrom<FSchedulerTls::FLocalQueueType, &FSchedulerTls::FLocalQueueType::DequeueSteal, false>(WorkerEvent, WorkerLocalQueue, OutOfWork, bPermitBackgroundWork))
```

#### 依赖示例

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

### AsyncTask(ENamedThreads::GameThread, ...)

由后台进程将工作放入游戏线程的任务队列中，等待进程调度的执行。 但这种方式不等同于直接调用游戏进程上的函数，而是把函数交给游戏进程执行。 

```
Worker Thread
    |
    | AsyncTask(GameThread, Lambda)
    v
任务提交给 GameThread 对应的队列
    |
    v
Game Thread 处理队列
    |
    v
执行 Lambda
```

### AsyncTask(ENamedThreads::AnyThread, ...)

将任务提交给 TaskGraph 调度器，不指定具体的执行线程。

```cpp
void AsyncTask(ENamedThreads::Type Thread, TUniqueFunction<void()> Function)
{
	TGraphTask<FAsyncGraphTask>::CreateTask().ConstructAndDispatchWhenReady(Thread, MoveTemp(Function));
}
```

```
Game Thread
    |
    | AsyncTask(AnyThread, ...)
    v
TaskGraph 调度器
    |
    +------ Worker A
    |
    +------ Worker B  <-- 执行任务
    |
    +------ Worker C
```

### Async(EAsyncExecution::ThreadPool, ...)

将工作放入线程池的等待队列，由空闲线程取出执行，并通过 Future 保存结果。

```cpp
TFuture<int32> Future = Async(
    EAsyncExecution::ThreadPool,
    []()
    {
        return 10 + 20;
    }
);

// 如果任务尚未完成，这里可能阻塞
int32 Result = Future.Get();
```

```
Game Thread
    |
    | Async(ThreadPool, Lambda)
    v
全局线程池的任务队列
    |
    +--> Worker 1 [正在执行其他任务]
    |
    +--> Worker 2 [空闲]
    |         |
    |         v
    |      执行 Lambda
    |         |
    |         v
    |      写入计算结果
    |
    v
Future 关联共享结果状态
    |
    v
调用 Get() 获取结果
```

### ParallelFor

数据并行。把循环的多个迭代分配给不同 Worker，同时执行，最后等待全部完成。

```cpp
TArray<float> Results;
Results.SetNum(1000);

ParallelFor(1000, [&Results](int32 Index)
{
    Results[Index] = FMath::Sqrt(static_cast<float>(Index));
});

// 这里所有循环迭代都已完成
```

`ParallelFor` 通常属于同步并行，调用它的线程通常要等全部计算完成才能继续。

### FRunnable + FRunnableThread

创建一个真实的操作系统线程，在这个线程上持续运行开发者指定的工作。



### 引擎专用异步 API

开发者提交操作请求，具体的任务拆分、线程调度、同步与结果交付交给引擎系统处理。

最常见的资产加载：

```cpp
FStreamableManager& Manager =
    UAssetManager::GetStreamableManager();

Manager.RequestAsyncLoad(
    AssetPath,
    FStreamableDelegate::CreateLambda([]()
    {
        // 资源加载完成后的处理
    })
);
```

异步加载并不等于把同步加载函数放到 Worker Thread 中执行

## 4. 常见问题

### 共享数据竞争

假设 `Count = 0`，两个线程执行普通整数的 `Count++`：

```
线程 A：读 0 → 算 1 ───────→ 写 1
线程 B：     读 0 → 算 1 → 写 1
```

同样的，对于容器来讲，它除了存放元素，还会存放缓冲区地址、元素数量、容量等信息。如果两个线程同时访问进行修改，如果产生扩容，甚至还可能导致旧指针失效。 

因允许读取或修改的情况如下：

- 多线程读取不再修改，且容器的生命周期覆盖整个读取的过程。 
- 一个线程读，另一个线程改，需要使用同步或者快照的方式。 
- 使用同一份数组，但不同线程使用的元素互不重叠。 

### 线程安全智能指针

`TSharedPtr<FData, ESPMode::ThreadSafe>` 线程安全指针，它主要负责的是解决多线程环境下对象生命周期的管理问题。

```cpp 
TSharedPtr<FData, ESPMode::ThreadSafe> Data =
    MakeShared<FData, ESPMode::ThreadSafe>();

UE::Tasks::Launch(TEXT("Calculate"), [Data]()
{
    // 工作线程持有 Data 的共享所有权
    ProcessData(Data.Get());
});

// 游戏线程
Data.Reset();
```

例如在当前这个例子，它不会保护 Data 的内容，但是它可以保证在线程使用完毕之前，这个对象不会被释放。

## 5. 同步工具

### 互斥锁

```cpp
#include "HAL/CriticalSection.h"
#include "Misc/ScopeLock.h"

class FSharedCounter
{
public:
    // 安全累加共享计数。
    void Increment()
    {
        FScopeLock Lock(&Mutex);

        ++Count;
    }

    // 返回加锁读取的计数快照。
    int32 GetCount()
    {
        FScopeLock Lock(&Mutex);

        return Count;
    }

private:
    FCriticalSection Mutex;

    int32 Count = 0;
};
```

`FScopeLock` 构造时 `Lock`，离开作用域时 `Unlock`，利用 RAII 防止某个 return 路径忘记解锁。

```cpp
class FScopeLock
{
public:

	/**
	 * Constructor that performs a lock on the synchronization object
	 *
	 * @param InSynchObject The synchronization object to manage
	 */
	UE_NODISCARD_CTOR FScopeLock( FCriticalSection* InSynchObject )
		: SynchObject(InSynchObject)
	{
		check(SynchObject);
		SynchObject->Lock();
	}

	/** Destructor that performs a release on the synchronization object. */
	~FScopeLock()
	{
		Unlock();
	}

	void Unlock()
	{
		if(SynchObject)
		{
			SynchObject->Unlock();
			SynchObject = nullptr;
		}
	}

private:

	/** Default constructor (hidden on purpose). */
	FScopeLock();

	/** Copy constructor( hidden on purpose). */
	FScopeLock(const FScopeLock& InScopeLock);

	/** Assignment operator (hidden on purpose). */
	FScopeLock& operator=( FScopeLock& InScopeLock )
	{
		return *this;
	}

private:

	// Holds the synchronization object to aggregate and scope manage.
	FCriticalSection* SynchObject;
};
```

### 原子操作

```cpp
#include <atomic>

std::atomic<int32> CompletedCount{0};

CompletedCount.fetch_add(1, std::memory_order_relaxed);
```

当两个线程同时对同一个原子变量执行 `fetch_add(1)` 时，CPU 提供的原子机制会保证这两次读-改-写操作不会互相覆盖。从外部观察，其效果等价于某个线程先完成加法，另一个线程再基于更新后的值进行加法。

需要注意的是原子变量不能保证业务安全，图中例子是两次独立的原子操作。 

```cpp
if (Stock.load() > 0)
{
    Stock.fetch_sub(1);
    // 购买成功
}
```

实际情况可能在条件判断阶段是满足的，其中某一个线程它先执行了购买，这样另一个线程它在执行到购买的时候很有可能会出现库存为零的情况，但仍然执行了购买。 

解决方式可以有加锁或者使用 compare and swap：

```cpp
std::atomic<int32> Stock{1};

bool TryBuy()
{
    int32 Expected = Stock.load();

    while (Expected > 0)
    {
        if (Stock.compare_exchange_weak(
                Expected,
                Expected - 1))
        {
            return true;
        }
    }

    return false;
}
```

## 6. 推荐的数据流

游戏线程取快照，后台计算，游戏线程提交：

```
Game Thread
  读取当前业务数据，复制为普通数据
  创建请求版本号和弱对象引用
          ↓ 移交快照
Worker
  只读取自己的快照，生成结果
          ↓ 将结果提交给 Game Thread
Game Thread
  检查对象有效、业务仍活跃、版本匹配
  应用结果，按业务需要通知 UI
```

通过读取快照可以解决以下问题：

1. **并发访问**：后台不读取正在变化的 Actor 数据。
2. **对象生命周期**：回调不依赖捕获的裸 `this`。
3. **业务时序**：较旧请求即使较晚完成，也不会覆盖新请求。

## 7. 具体示例

### UE::Tasks

`AsyncScoreComponent.h`：

```cpp
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "AsyncScoreComponent.generated.h"

UCLASS()
class UAsyncScoreComponent : public UActorComponent
{
    GENERATED_BODY()

protected:
    virtual void BeginPlay() override;

    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

public:
    // 在游戏线程发起计算；只接收普通位置快照，较新的请求替代旧请求。
    void RequestScores(TArray<FVector> Points);

private:
    // 只在游戏线程提交当前有效请求的结果。
    void ApplyScores(uint64 Revision, TArray<float> Scores);

    // 下列状态全部归游戏线程拥有，后台任务不读取它们。
    uint64 RequestRevision = 0;

    bool bAcceptResults = false;

    TArray<float> LatestScores;
};
```

`AsyncScoreComponent.cpp`：

```cpp
#include "AsyncScoreComponent.h"

#include "Async/Async.h"
#include "ProfilingDebugging/CpuProfilerTrace.h"
#include "Tasks/Task.h"

void UAsyncScoreComponent::BeginPlay()
{
    Super::BeginPlay();

    bAcceptResults = true;
}

void UAsyncScoreComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    check(IsInGameThread());

    bAcceptResults = false;

    ++RequestRevision;

    Super::EndPlay(EndPlayReason);
}

void UAsyncScoreComponent::RequestScores(TArray<FVector> Points)
{
    check(IsInGameThread());

    if (!bAcceptResults)
    {
        return;
    }

    const uint64 Revision = ++RequestRevision;
    
	// 不直接使用 this 的原因是异步任务的执行时间是不固定的。 
    TWeakObjectPtr<UAsyncScoreComponent> WeakThis(this);

    // 提交后台执行计算任务
    UE::Tasks::Launch(UE_SOURCE_LOCATION,
        [WeakThis, Revision, Points = MoveTemp(Points)]()
        {
            // 用于 CPU 性能分析，可帮助你在 Unreal Insights 中识别这段计算
            TRACE_CPUPROFILER_EVENT_SCOPE(ComputeCandidateScores);

            TArray<float> Scores;

            Scores.SetNumUninitialized(Points.Num());

            for (int32 Index = 0; Index < Points.Num(); ++Index)
            {
                Scores[Index] = static_cast<float>(Points[Index].SizeSquared());
            }

            // 将计算的结果回传至游戏线程
            AsyncTask(ENamedThreads::GameThread,
                [WeakThis, Revision, Scores = MoveTemp(Scores)]() mutable
                {
                    if (UAsyncScoreComponent* Component = WeakThis.Get())
                    {
                        Component->ApplyScores(Revision, MoveTemp(Scores));
                    }
                });
        });
}

void UAsyncScoreComponent::ApplyScores(uint64 Revision, TArray<float> Scores)
{
    check(IsInGameThread());

    if (!bAcceptResults || Revision != RequestRevision)
    {
        return;
    }

    LatestScores = MoveTemp(Scores);

    // 在这里根据项目需要通知 UI 或更新游戏状态。
}
```

- `UE_SOURCE_LOCATION` 是 Unreal Engine 提供的一个宏，用于记录当前代码所在的源文件位置，主要用于任务调试和性能分析。
- Points = MoveTemp(Points) 通过移动语义可以避免拷贝一份。 
- Revision 阻止旧任务的结果生效

### ParallelFor

```cpp
#include "Async/ParallelFor.h"

TArray<FVector> Input = /* 已经准备好的普通位置快照 */;

TArray<float> Output;

Output.SetNumUninitialized(Input.Num());

ParallelFor(Input.Num(), [&Input, &Output](int32 Index)
{
    Output[Index] = static_cast<float>(Input[Index].SizeSquared());
});

// 这里循环已完成，Output 可以由调用者继续使用。
```

`Input` 不在循环期间变化，`Output` 提前分配完成，每次迭代写独立的 float 元素，没有并发 Add/Resize；每个索引只由对应迭代写入。这是它安全的关键。

错误使用：

```cpp
ParallelFor(Input.Num(), [&Input, &Output](int32 Index)
{
    Output.Add(static_cast<float>(Input[Index].SizeSquared())); // 错：并发改数组结构。
});
```

### FRunnable

适用于长期接收外部数据、持续消费专门队列等需要独立生命周期的工作。短小计算优先采用任务系统。

`FRunnable` 定义工作逻辑，`FRunnableThread` 创建并管理执行线程。

```cpp
创建线程 → 在线程中 Init → Init 成功后 Run → Run 返回后 Exit
```

那么如何让拥有者尝试关闭或退出此进程呢？ 

1. 停止接收新工作，组件不再向工作队列提交新的 AI 计算任务。

2. 设置停止标志，通过原子操作将此变量设置为 false。 

   ```cpp
   while (!bStopRequested.Load())
   {
       // 处理任务
   }
   
   return 0;
   ```

3. 唤醒正在等待的线程。有些工作线程为了节省 CPU，不会一直空转，需要唤醒工作线程`WorkEvent->Trigger();`，让它有机会检查停止标志并退出。

最后需要释放资源。

```cpp
Game Thread（游戏线程）
    │
    └── UMyWorkerComponent（拥有者）
          │
          ├── FMyWorker（工作逻辑对象）
          │     ├── 任务队列
          │     ├── 停止标志
          │     └── Run()
          │
          └── FRunnableThread（线程管理对象）
                │
                └── OS Worker Thread
                      │
                      └── 执行 FMyWorker::Run()
                            │
                            ├── 任务 A
                            ├── 任务 B
                            └── 任务 C
```

MyWorker.h

```cpp
#pragma once

#include "CoreMinimal.h"
#include "HAL/Runnable.h"
#include "Containers/Queue.h"
#include "Templates/Atomic.h"

class FMyWorker : public FRunnable
{
public:
    // 供游戏线程添加任务
    void AddTask(int32 Value)
    {
        TaskQueue.Enqueue(Value);
    }

    // 在工作线程中执行
    virtual uint32 Run() override
    {
        while (!bStopRequested.Load())
        {
            int32 Value;

            if (TaskQueue.Dequeue(Value))
            {
                // 模拟耗时计算
                const int32 Result = Value * Value;

                UE_LOG(LogTemp, Log, TEXT("Worker: %d -> %d"), Value, Result);
            }
            else
            {
                // 没有任务，稍微休眠
                FPlatformProcess::Sleep(0.01f);
            }
        }

        UE_LOG(LogTemp, Log, TEXT("Worker Run End"));

        return 0;
    }

    // 请求工作线程退出
    virtual void Stop() override
    {
        bStopRequested.Store(true);
    }

private:
    // 多生产者、单消费者队列
    TQueue<int32, EQueueMode::Mpsc> TaskQueue;

    // 跨线程共享的停止标志
    TAtomic<bool> bStopRequested{false};
};
```

MyWorkerComponent.h

```cpp
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "MyWorkerComponent.generated.h"

class FMyWorker;
class FRunnableThread;

UCLASS(ClassGroup=(Custom), meta=(BlueprintSpawnableComponent))
class UMyWorkerComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    virtual void BeginPlay() override;

    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

private:
    FMyWorker* Worker = nullptr;

    FRunnableThread* WorkerThread = nullptr;
};
```

MyWorkerComponent.cpp

```cpp
#include "MyWorkerComponent.h"

#include "MyWorker.h"
#include "HAL/RunnableThread.h"

void UMyWorkerComponent::BeginPlay()
{
    Super::BeginPlay();

    // 1. 创建工作逻辑对象
    Worker = new FMyWorker();

    // 2. 创建真正的操作系统线程
    WorkerThread = FRunnableThread::Create(
        Worker,
        TEXT("MyWorkerThread")
    );

    // 创建失败时清理 Worker
    if (!WorkerThread)
    {
        delete Worker;
        Worker = nullptr;
        return;
    }

    // 3. 提交三个任务
    Worker->AddTask(10);
    Worker->AddTask(20);
    Worker->AddTask(30);
}

void UMyWorkerComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    // 1. 请求线程退出
    if (Worker)
    {
        Worker->Stop();
    }

    // 2. 等待 Run() 真正结束
    if (WorkerThread)
    {
        WorkerThread->WaitForCompletion();

        delete WorkerThread;
        WorkerThread = nullptr;
    }

    // 3. 线程已经结束，可以释放 Worker
    delete Worker;
    Worker = nullptr;

    Super::EndPlay(EndPlayReason);
}
```

### 异步存档

本地 `AsyncSaveGameToSlot` 先调用 `SaveGameToMemory` 将对象序列化为字节，然后调用平台存档系统的 `SaveGameAsync`。正常 Gameplay 使用下，对象序列化发生在发起它的游戏线程，平台异步工作再处理存储阶段。

## 8. 死锁、卡顿和并行变慢

死锁：A 持有 Lock1 等 Lock2，B 持有 Lock2 等 Lock1。

任务太小，调度成本比计算还大。

### 伪共享：没数据竞争，也可能慢

不同线程分别写相邻变量，变量可能位于同一 CPU 缓存行。缓存一致性使这条缓存行在核心间反复转移，拖慢执行。

> 在此之前呢，先了解一下什么是缓存一致性？
> 
>
> 缓存一致性（Cache Coherence）：多个 CPU 核心缓存同一内存地址的数据时，通过硬件协议协调读写，确保各核心不会持续使用过期的数据副本。
> 
>
> 假设两个 CPU 核心各自保存了一份变量 `Count` 的副本。当核心 A 修改了 `Count`，缓存一致性机制会让核心 B 原来的副本失效。这样核心 B 下次读取时，就必须获取最新的数据，而不能继续使用旧值。

下方的两个线程，使用的变量，它不会出现数据竞争，但仍然会导致变慢。 

```cpp
struct FTaskCounters
{
    std::atomic<int32> AICount{0};
    std::atomic<int32> AnimationCount{0};
};

FTaskCounters Counters;

// Worker A
for (int32 i = 0; i < 1000000; ++i)
{
    Counters.AICount.fetch_add(1, std::memory_order_relaxed);
}

// Worker B
for (int32 i = 0; i < 1000000; ++i)
{
    Counters.AnimationCount.fetch_add(1, std::memory_order_relaxed);
}
```

现代 CPU 通常是以缓存行为单位进行缓存一致性的管理。按照示例中两个 int32 类型，它们很有可能被放在同一个缓存行当中。 

例如，核心 A 正在执行线程 A 的任务，它修改了 AICount 的值。由于缓存一致性，核心 B 对应的记录这个 AICount 的缓存行会被设置为无效，下一次使用的时候需要重新获取，进而就导致核心 A 上的线程调整了值，会导致核心 B 的缓存无效，每次使用的时候需要重新获取。同样的，对核心 B 进行调整，核心 A 的数据也会被设置无效。 

因此真正的浪费就在缓存一致性上面。 

调整的方向可以是将两个变量设置在不同的缓存行，就需要进行对齐。按照现在主流 CPU，它的缓存行大小通常是 64 字节，不过这样做之后会导致空间浪费。 

```cpp
struct FCounters
{
    alignas(64) std::atomic<int32> A{0};
    alignas(64) std::atomic<int32> B{0};
};
```

## 一些提问

**为什么 ParallelFor 可以按引用捕获局部数组，而长期异步任务一般不行？**

因为 ParallelFor 是一个同步接口，它会等待内部的工作线程并行执行完毕之后才会退出。 捕获的局部数组在这个过程中它是一直存在的，不会失效。 对于长期异步来说，很有可能在执行过程中这个局部数组就已经被销毁了，这会导致非法，不会保证在当前作用域结束前完成，因此长期异步任务通常可以借助移动语义或者直接拷贝一份进去。
