---
title: "Multithreading in Game Engines: Thread Roles, Task Systems, and Synchronization"
description: ""
publishedAt: 2026-10-11
tags: ["Unreal Engine","Thread","source-reading"]
draft: false
---

My personal understanding and learning notes, written from the perspective of a **junior programmer**.

## 1. Why Engines Need Multiple Threads

At 60 FPS, the frame budget is about 16.67 ms; at 120 FPS, it is about 8.33 ms. If character logic, animation, physics, asset loading, and rendering preparation all run serially on one thread, they can easily exceed that budget.

> $$
> \text{Frame time budget}=\frac{1000\text{ ms}}{\text{FPS}}
> $$

Suppose one stage contains three pure computations:

```
Single thread: A 4ms -> B 4ms -> C 4ms -> Combine 1ms, about 13ms

Parallel: Worker 1: A 4ms |
          Worker 2: B 4ms |-> Combine 1ms, ideally about 5ms
     Worker 3：C 4ms ┘
```

If B must read the result of A, and C must read the result of B, the dependency remains `A → B → C`. Moving them to three threads does not remove that dependency.

### Four Concepts

| Concept | Plain explanation | Engine example |
| ---- | ------------------------------------------ | ------------------------------------ |
| Thread | The basic unit the operating system schedules on a CPU | Game Thread, Render Thread, Worker |
| Task | A piece of work to execute; it is not itself a thread | Splitting animation calculations for a group of characters into multiple tasks |
| Concurrency | Multiple pieces of work progress during the same period, without necessarily executing simultaneously | One CPU core switches between multiple threads |
| Parallelism | Multiple pieces of work actually execute at the same instant | Multiple CPU cores execute the game thread and render thread simultaneously |
| Asynchrony | The caller can continue doing other work without immediately waiting for the result | Loading assets asynchronously and processing the result in a callback |

Asynchrony describes the relationship between starting an operation and its completion. Multithreading describes how work executes. They are not equivalent.

Each thread has its own call stack and register state. Threads within the same process usually share memory. Copying a pointer to another thread still points to the same address and the same data.

### Common Threads in UE

| Thread or execution domain | Main responsibilities | Notes |
| -------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| Game Thread | World, Actor, regular Gameplay, and most UObject/UMG operations | The default place for reading and modifying ordinary gameplay objects |
| Render Thread | Consuming rendering data and organizing rendering work | Exchange data through rendering interfaces; do not read Actor state arbitrarily |
| RHI Thread (Render Hardware Interface Thread), when enabled | Executing part of the RHI command submission work | Depends on the platform, RHI, and configuration; a dedicated thread is not guaranteed |
| Task Workers | Executing schedulable work in the task system | Suitable for bounded, independent computation; avoid prolonged blocking |
| Queued Thread Pool | Processing queued background work | Do not treat it as the same pool as task system Workers |
| Loading, audio, and other threads | Dedicated or asynchronous work for specific systems | Use the system APIs; the exact division depends on the platform and configuration |
| GPU | Executing submitted graphics and compute commands | The GPU is a processor, not a C++ worker thread |

## 2. What Happens in a Frame?

A typical rendering pipeline:

```
Game Thread: update game state and produce rendering updates
      ↓ Submit data/commands
Render Thread: organize rendering commands
      ↓
RHI execution/submission (possibly on a dedicated RHI Thread)
      ↓
GPU: execute graphics work
```

Actual timing also depends on synchronization points, GPU presentation, and frame rate limits, so frame timings cannot simply be added together.

> A synchronization point is a place where threads or execution units must wait for some work to finish before proceeding.
>
> ![img](data:image/svg+xml;charset=utf-8,%3Csvg%20font-family%3D%22-apple-system-body%2C%20ui-sans-serif%2C%20-apple-system%2C%20system-ui%2C%20%26quot%3BSegoe%20UI%26quot%3B%2C%20Helvetica%2C%20%26quot%3BApple%20Color%20Emoji%26quot%3B%2C%20Arial%2C%20sans-serif%2C%20%26quot%3BSegoe%20UI%20Emoji%26quot%3B%2C%20%26quot%3BSegoe%20UI%20Symbol%26quot%3B%22%20font-weight%3D%22400%22%20data-d-component%3D%22svg%22%20fill%3D%22currentColor%22%20style%3D%22color%3Argb(13%2C%2013%2C%2013)%22%20viewBox%3D%220%200%20340%20190%22%20width%3D%22100%25%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ctext%20x%3D%228%22%20y%3D%2246%22%20fill%3D%22currentColor%22%20font-size%3D%2211%22%20font-weight%3D%22600%22%3EGame%20Thread%3C%2Ftext%3E%3Ctext%20x%3D%228%22%20y%3D%22120%22%20fill%3D%22currentColor%22%20font-size%3D%2211%22%20font-weight%3D%22600%22%3ERender%20Thread%3C%2Ftext%3E%3Crect%20x%3D%22111%22%20y%3D%2232%22%20width%3D%2265%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%2316A34A%22%20opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22176%22%20y%3D%2232%22%20width%3D%2281%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%23EAB308%22%20opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22257%22%20y%3D%2232%22%20width%3D%2269%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%2316A34A%22%20opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22111%22%20y%3D%22106%22%20width%3D%22146%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%230D9488%22%20opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22257%22%20y%3D%22106%22%20width%3D%2269%22%20height%3D%2222%22%20rx%3D%224%22%20fill%3D%22%2364748B%22%20opacity%3D%22.4%22%2F%3E%3Cg%20font-size%3D%2210%22%20fill%3D%22%23fff%22%20text-anchor%3D%22middle%22%3E%3Ctext%20x%3D%22143%22%20y%3D%2247%22%3E%E6%89%A7%E8%A1%8C%E9%80%BB%E8%BE%91%3C%2Ftext%3E%3Ctext%20x%3D%22216%22%20y%3D%2247%22%20fill%3D%22%2327272A%22%3E%E7%AD%89%E5%BE%85%3C%2Ftext%3E%3Ctext%20x%3D%22291%22%20y%3D%2247%22%3E%E7%BB%A7%E7%BB%AD%E6%89%A7%E8%A1%8C%3C%2Ftext%3E%3Ctext%20x%3D%22183%22%20y%3D%22121%22%3E%E6%89%A7%E8%A1%8C%E6%B8%B2%E6%9F%93%E4%BB%BB%E5%8A%A1%3C%2Ftext%3E%3C%2Fg%3E%3Cline%20x1%3D%22257%22%20y1%3D%2225%22%20x2%3D%22257%22%20y2%3D%22140%22%20stroke%3D%22%23F59E0B%22%20stroke-dasharray%3D%224%203%22%20stroke-width%3D%221.5%22%2F%3E%3Ctext%20x%3D%22257%22%20y%3D%2217%22%20font-size%3D%2210%22%20fill%3D%22%23D97706%22%20text-anchor%3D%22middle%22%3E%E5%90%8C%E6%AD%A5%E5%AE%8C%E6%88%90%3C%2Ftext%3E%3Ctext%20x%3D%22111%22%20y%3D%22172%22%20fill%3D%22currentColor%22%20opacity%3D%22.65%22%20font-size%3D%2210%22%3E%E6%97%B6%E9%97%B4%20%E2%86%92%3C%2Ftext%3E%3Cpath%20d%3D%22M147%20169%20H326%22%20stroke%3D%22currentColor%22%20opacity%3D%22.4%22%20stroke-width%3D%221.2%22%2F%3E%3Cpath%20d%3D%22M321%20165%20L327%20169%20L321%20173%22%20stroke%3D%22currentColor%22%20opacity%3D%22.4%22%20fill%3D%22none%22%2F%3E%3C%2Fsvg%3E)

### Why Not Let the Render Thread Read Actors Directly?

The game thread might be changing an Actor's position or destroying an Actor. If the render thread reads that same object's state at the same time, a race condition can occur.

| Time | Game Thread | Render Thread |
| ---- | ------------ | ------------ |
| T1 | Write X = 500 | — |
| T2 | — | Read X = 500 |
| T3 | — | Read Y = 200 |
| T4 | — | Read Z = 300 |

A good way to resolve this is to copy a snapshot of the data to the other thread.

## 3. Common APIs

| API | Typical use | Example |
| ------------------------------- | ------------------------ | ---------------------------------------------------- |
| `UE::Tasks::Launch` | Independent computation and task dependencies | Calculate threat scores for many enemies in the background, then use the results to determine target priorities |
| `AsyncTask(GameThread, ...)` | Switching to the game thread | Update Actor state on the game thread after calculating pathfinding data in the background |
| `AsyncTask(AnyThread, ...)` | Simple background work | Analyze a batch of plain C++ combat logs without returning a value |
| `Async(ThreadPool, ...)` | Background computation with a result | Calculate equipment scores in the background and retrieve the result through `TFuture` |
| `ParallelFor` | Many independent, similar calculations | Calculate squared distances from 1,000 enemies to the player in parallel |
| `FRunnable` + `FRunnableThread` | A dedicated thread that runs continuously | Create a network listener thread that continuously receives external TCP data |
| Engine-specific asynchronous APIs | Asynchronous operations provided by engine systems | Load character models and animation assets asynchronously through `FStreamableManager` |

### TaskGraph and UE::Tasks

[Epic's official documentation](https://dev.epicgames.com/documentation/unreal-engine/tasks-systems-in-unreal-engine?lang=en-US) explicitly presents `UE::Tasks` (Tasks System) as an improvement over the traditional `TaskGraph`. With the default new backend, both share the underlying LowLevelTasks scheduling infrastructure.

The **Tasks System** is a job manager that can execute game code asynchronously. It supports building and running directed acyclic graphs of dependent tasks.

#### How Workers Find Work

The scheduler maintains queues. When a Worker is idle, it looks for executable tasks in other queues, reducing idle time and making fuller use of resources.

```cpp
while(
    TryExecuteTaskFrom<FSchedulerTls::FLocalQueueType, &FSchedulerTls::FLocalQueueType::Dequeue, false>(WorkerEvent, WorkerLocalQueue, OutOfWork, bPermitBackgroundWork)
   ||
   TryExecuteTaskFrom<FSchedulerTls::FLocalQueueType, &FSchedulerTls::FLocalQueueType::DequeueSteal, false>(WorkerEvent, WorkerLocalQueue, OutOfWork, bPermitBackgroundWork))
```

#### A Dependency Example

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

A and B can execute independently. `UE::Tasks::Prerequisites(TaskA, TaskB)` means CombinedTask becomes eligible to run only after both have finished.

### AsyncTask(ENamedThreads::GameThread, ...)

Background work places a function in the game thread's task queue and waits for it to be scheduled. This does not directly call the function on the game thread; it hands the function over for that thread to execute.

```
Worker Thread
    |
    | AsyncTask(GameThread, Lambda)
    v
Task submitted to the queue for GameThread
    |
    v
Game Thread processes the queue
    |
    v
Execute Lambda
```

### AsyncTask(ENamedThreads::AnyThread, ...)

Submit a task to the TaskGraph scheduler without specifying a particular execution thread.

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
TaskGraph scheduler
    |
    +------ Worker A
    |
    +------ Worker B  <-- Executes the task
    |
    +------ Worker C
```

### Async(EAsyncExecution::ThreadPool, ...)

Place work in the thread pool's waiting queue. An available thread picks it up and executes it, while a Future holds the result.

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
Global thread pool task queue
    |
    +--> Worker 1 [Executing other work]
    |
    +--> Worker 2 [Idle]
    |         |
    |         v
    |      Execute Lambda
    |         |
    |         v
    |      Store the computed result
    |
    v
Shared result state associated with the Future
    |
    v
Call Get() to retrieve the result
```

### ParallelFor

Data parallelism: distribute loop iterations across different Workers, execute them concurrently, and wait for all iterations to finish.

```cpp
TArray<float> Results;
Results.SetNum(1000);

ParallelFor(1000, [&Results](int32 Index)
{
    Results[Index] = FMath::Sqrt(static_cast<float>(Index));
});

// 这里所有循环迭代都已完成
```

`ParallelFor` is usually synchronous parallelism: the calling thread normally waits for all calculations to finish before continuing.

### FRunnable + FRunnableThread

Create a real operating system thread that continuously executes work defined by the developer.



### Engine-Specific Asynchronous APIs

The developer submits an operation request. The engine system handles task decomposition, thread scheduling, synchronization, and result delivery.

A common example is asset loading:

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

Asynchronous loading is not equivalent to putting a synchronous loading function on a Worker Thread.

## 4. Common Problems

### Races on Shared Data

Suppose `Count = 0` and two threads execute `Count++` on an ordinary integer:

```
Thread A: Read 0 -> Compute 1 ----------> Write 1
Thread B:      Read 0 -> Compute 1 -> Write 1
```

A container stores more than its elements: it also stores a buffer address, element count, capacity, and other metadata. If two threads modify it concurrently and a reallocation occurs, existing pointers may even become invalid.

The relevant access patterns are:

- Multiple threads read data that is no longer modified, and the container remains alive throughout every read.
- If one thread reads while another modifies the data, use synchronization or snapshots.
- Threads may use the same array when the elements each thread accesses do not overlap.

### Thread-Safe Smart Pointers

`TSharedPtr<FData, ESPMode::ThreadSafe>` primarily manages an object's lifetime in a multithreaded environment.

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

In this example, it does not protect the contents of Data, but it ensures that the object is not released while the worker still uses it.

## 5. Synchronization Tools

### Mutexes

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

`FScopeLock` calls `Lock` during construction and `Unlock` when leaving scope. RAII prevents a return path from accidentally leaving the mutex locked.

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

### Atomic Operations

```cpp
#include <atomic>

std::atomic<int32> CompletedCount{0};

CompletedCount.fetch_add(1, std::memory_order_relaxed);
```

When two threads call `fetch_add(1)` on the same atomic variable, the CPU's atomic mechanisms ensure that the two read-modify-write operations do not overwrite each other. From the outside, the effect is equivalent to one addition completing before the other uses the updated value.

An atomic variable alone does not guarantee correctness of the business logic. The following example performs two separate atomic operations.

```cpp
if (Stock.load() > 0)
{
    Stock.fetch_sub(1);
    // 购买成功
}
```

Both threads might pass the condition check. One then completes its purchase first, leaving zero stock when the other reaches the purchase step, yet the second purchase still proceeds.

Possible solutions include locking or compare-and-swap:

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

## 6. Recommended Data Flow

Take a snapshot on the game thread, calculate in the background, and apply the result on the game thread:

```
Game Thread
  Read current gameplay data and copy it into plain arrays
  Capture the request revision and a weak reference to the owner
          ↓ Move into the task
Worker
  Read only its own snapshot and produce a result
          ↓ Submit the result back to the Game Thread
Game Thread
  Check: valid object, active gameplay, matching revision
  Apply the result and notify the UI as required
```

Reading snapshots addresses the following problems:

1. **Concurrent access**: background work does not read Actor data while it changes.
2. **Object lifetime**: the callback does not depend on a captured raw `this` pointer.
3. **Request ordering**: an older request cannot overwrite a newer one even if it finishes later.

## 7. Practical Examples

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

- `UE_SOURCE_LOCATION` is an Unreal Engine macro that records the current source location, mainly for task debugging and profiling.
- `Points = MoveTemp(Points)` uses move semantics to avoid making a copy.
- Revision prevents results from older tasks from taking effect.

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

`Input` stays unchanged during the loop, and `Output` is allocated in advance. Each iteration writes a separate float element, with no concurrent Add/Resize operations. Each index is written only by its corresponding iteration. These are the key safety conditions.

Incorrect usage:

```cpp
ParallelFor(Input.Num(), [&Input, &Output](int32 Index)
{
    Output.Add(static_cast<float>(Input[Index].SizeSquared())); // 错：并发改数组结构。
});
```

### FRunnable

Suitable for work with an independent lifetime, such as continuously receiving external data or consuming a dedicated queue. Prefer the task system for short computations.

`FRunnable` defines the work logic; `FRunnableThread` creates and manages the execution thread.

```cpp
Create thread -> Init on the thread -> Run if Init succeeds -> Exit after Run returns
```

How can the owner request that this worker shut down?

1. Stop accepting new work. The component no longer submits new AI calculation tasks to the queue.

2. Set the stop flag through an atomic operation, setting this variable to false.

   ```cpp
   while (!bStopRequested.Load())
   {
       // 处理任务
   }
   
   return 0;
   ```

3. Wake a waiting thread. Some workers wait instead of spinning to save CPU time. Call `WorkEvent->Trigger();` so the worker can check the stop flag and exit.

Finally, release the resources.

```cpp
Game Thread
    │
    └── UMyWorkerComponent (owner)
          │
          ├── FMyWorker (work logic object)
          │     ├── Task queue
          │     ├── Stop flag
          │     └── Run()
          │
          └── FRunnableThread (thread management object)
                │
                └── OS Worker Thread
                      │
                      └── Execute FMyWorker::Run()
                            │
                            ├── Task A
                            ├── Task B
                            └── Task C
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

### Asynchronous Saving

The local `AsyncSaveGameToSlot` implementation first calls `SaveGameToMemory` to serialize the object into bytes, then calls the platform save system's `SaveGameAsync`. In normal Gameplay usage, object serialization happens on the initiating game thread, and platform asynchronous work handles the storage stage afterward.

## 8. Deadlocks, Stalls, and Slower Parallel Execution

Deadlock: A holds Lock1 while waiting for Lock2, and B holds Lock2 while waiting for Lock1.

If tasks are too small, scheduling can cost more than the computation itself.

### False Sharing: Slowdowns Without Data Races

Different threads write adjacent variables that may share a CPU cache line. Cache coherence causes the line to move repeatedly between cores, slowing execution.

> First, what is cache coherence?
> 
>
> Cache coherence uses hardware protocols to coordinate reads and writes when multiple CPU cores cache data from the same memory address, ensuring that cores do not keep using stale copies.
> 
>
> Suppose two CPU cores each cache a copy of `Count`. When core A modifies `Count`, the coherence mechanism invalidates core B's old copy. The next time B reads it, B must obtain the latest data instead of using the old value.

The two threads below do not have a data race on these variables, but they can still slow each other down.

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

Modern CPUs usually manage cache coherence at cache-line granularity. The two int32 values in this example are likely to occupy the same cache line.

For example, core A executes thread A and updates AICount. Cache coherence invalidates the corresponding line on core B, which must obtain it again on its next access. Updates from core A therefore invalidate B's cache, and updates from core B likewise invalidate A's cached data.

The real overhead comes from maintaining cache coherence.

One approach is to align the variables so that they occupy different cache lines. Cache lines on mainstream CPUs are commonly 64 bytes, though this approach uses additional space.

```cpp
struct FCounters
{
    alignas(64) std::atomic<int32> A{0};
    alignas(64) std::atomic<int32> B{0};
};
```

## Questions

**Why can ParallelFor capture a local array by reference, while a long-running asynchronous task generally cannot?**

ParallelFor is synchronous: it returns only after its internal workers finish their parallel work. The captured local array remains alive throughout that period. A long-running asynchronous task is not guaranteed to finish before the current scope ends, so the local array might already be destroyed while the task is using it, causing invalid access. Such tasks usually move the data into the task or capture a copy instead.
