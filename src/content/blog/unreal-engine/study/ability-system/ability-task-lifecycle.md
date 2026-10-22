---
title: "AbilityTask 生命周期"
description: "梳理 GAS 中 AbilityTask 的创建、激活、结束与 GC 回收流程。"
publishedAt: 2026-09-12
tags:
    - Unreal Engine
    - GAS
    - AbilityTask
draft: true
---

常见的Ability异步任务如下：

```text
等待 Montage
    → PlayMontageAndWait

等待 GameplayEvent
    → WaitGameplayEvent

等待输入
    → WaitInputPress
    → WaitInputRelease

等待 TargetData
    → WaitTargetData

等待 GameplayEffect
    → WaitGameplayEffectApplied

等待 Tag
    → WaitGameplayTagAdd / Remove
```

他们和Ability实例的关系可以是：

```text
GA_Attack 实例
│
├── Task_PlayMontage
│
├── Task_WaitGameplayEvent
│
└── Task_WaitInput
```

## 创建流程

一次任务创建的完整流程如下：

```text
创建
↓
设置参数
↓
绑定 Delegate
↓
ReadyForActivation
↓
GameplayTask 系统安排它进入 Active
↓
Activate()
```

### 新建

```cpp
template <class T>
static T* NewAbilityTask(UGameplayAbility* ThisAbility, FName InstanceName = FName())
{
    check(ThisAbility);

    T* MyObj = NewObject<T>();
    MyObj->InitTask(*ThisAbility, ThisAbility->GetGameplayTaskDefaultPriority());

    UAbilityTask::DebugRecordAbilityTaskCreatedByAbility(ThisAbility);

    MyObj->InstanceName = InstanceName;
    return MyObj;
}
```

1. 传入当前Ability实例。
2. 设置此任务的的拥有者（也就是当前Ability实例）和优先级。

```cpp
/** Initializes the task with the task owner interface instance but does not activate until Activate() is called */
GAMEPLAYTASKS_API void InitTask(IGameplayTaskOwnerInterface& InTaskOwner, uint8 InPriority);
```

### 绑定监听

在准备激活前呢可以绑定一些监听：

```cpp
Task->OnSuccess.AddDynamic(this, &ThisClass::HandleSuccess);

Task->OnFailed.AddDynamic(this, &ThisClass::HandleFailed);
```

### 激活

```cpp
/** Called to trigger the actual task once the delegates have been set up */
UFUNCTION(BlueprintCallable, meta = (BlueprintInternalUseOnly = "true"), Category = "Gameplay Tasks")
GAMEPLAYTASKS_API void ReadyForActivation();
```

该方法表示这个Task已经初始化和配置完成，现在可以交给 GameplayTask 系统进入激活流程。

进一步看，可以发现最终的激活方法`Activate()`：

```cpp
void UGameplayTask::ReadyForActivation()
{
    if (UGameplayTasksComponent* TasksPtr = TasksComponent.Get())
    {
        if (RequiresPriorityOrResourceManagement() == false)
        {
            PerformActivation();
        }
        else
        {
            TasksPtr->AddTaskReadyForActivation(*this);
        }
    }
    else
    {
        EndTask();
    }
}

void UGameplayTask::PerformActivation()
{
    if (TaskState == EGameplayTaskState::Active)
    {
        UE_VLOG(GetGameplayTasksComponent(), LogGameplayTasks, Warning
            , TEXT("%s PerformActivation called while TaskState is already Active. Bailing out.")
            , *GetName());
        return;
    }

    TaskState = EGameplayTaskState::Active;

    Activate();

    // Activate call may result in the task actually "instantly" finishing.
    // If this happens we don't want to bother the TaskComponent
    // with information on this task
    if (IsFinished() == false)
    {
        TasksComponent->OnGameplayTaskActivated(*this);
    }
}
```

## 结束流程

```text
Task 条件满足
    │
    ▼
EndTask()
    │
    ▼
UAbilityTask::OnDestroy()
    │
    ▼
UGameplayTask::OnDestroy()
    │
    ▼
Finished
    │
    ▼
失去引用后等待 GC
```

### 结束

```cpp
/** Called explicitly to end the task (usually by the task itself). Calls OnDestroy. 
 *  @NOTE: you need to call EndTask before sending out any "on completed" delegates. 
 *  If you don't the task will still be in an "active" state while the event receivers may
 *  assume it's already "finished" */
UFUNCTION(BlueprintCallable, Category="GameplayTasks")
GAMEPLAYTASKS_API void EndTask();
```

核心逻辑可以简化成：

```cpp
void UGameplayTask::EndTask()
{
    if (TaskState != EGameplayTaskState::Finished)
    {
        OnDestroy(false);
    }
}

void UGameplayTask::OnDestroy(bool bInOwnerFinished)
{
    TaskState = EGameplayTaskState::Finished;

    if (UGameplayTasksComponent* TasksPtr = TasksComponent.Get())
    {
        TasksPtr->OnGameplayTaskDeactivated(*this);
    }

    MarkAsGarbage();
}
```

注意`UAbilityTask` 重写了`OnDestroy` 方法：

```cpp
void UAbilityTask::OnDestroy(bool bInOwnerFinished)
{
    // If we have already been destroyed this is being called recursively so skip the tracking as well as the super call
    if (!bWasSuccessfullyDestroyed)
    {
        if (!HasAnyFlags(RF_ClassDefaultObject))
        {
            --GlobalAbilityTaskCount;
            SET_DWORD_STAT(STAT_AbilitySystem_TaskCount, GlobalAbilityTaskCount);

            if (AbilityTaskCVars::AbilityTaskRecordingType >= AbilityTaskConstants::DebugMinValueToEnableRecording)
            {
                DebugRecordAbilityTaskDestroyed(this);
            }
        }

        bWasSuccessfullyDestroyed = true;

        // #KillPendingKill Clear ability reference so we don't hold onto it and GC can delete it.
        Ability = nullptr;

        Super::OnDestroy(bInOwnerFinished);
    }
}
```

`bInOwnerFinished` 表示 它的 Owner 已经结束，被迫销毁的，例如GA_Attack->EndAbility(...)，但它的Task仍然在运行，则GAS会将其去掉。

可以去EndAbility()看一下，会发现`OnDestroy(true);` ：

```cpp
// Tell all our tasks that we are finished and they should cleanup
for (int32 TaskIdx = ActiveTasks.Num() - 1; TaskIdx >= 0 && ActiveTasks.Num() > 0; --TaskIdx)
{
    UGameplayTask* Task = ActiveTasks[TaskIdx];
    if (Task)
    {
        Task->TaskOwnerEnded();
    }
}
ActiveTasks.Reset();    // Empty the array but don't resize memory, since this object is probably going to be destroyed very soon anyways.

void UGameplayTask::TaskOwnerEnded()
{
    UE_VLOG(GetGameplayTasksComponent(), LogGameplayTasks, Verbose
        , TEXT("%s TaskOwnerEnded called, current State: %s")
        , *GetName(), *GetTaskStateName());

    if (TaskState != EGameplayTaskState::Finished)
    {
        bOwnerFinished = true;
        if (IsValid(this))
        {
            OnDestroy(true); // 这里传入的参数是true！！！
        }
        else
        {
            // mark as finished, just to be on the safe side 
            TaskState = EGameplayTaskState::Finished;
        }
    }
}
```

### GC回收

跳转到上方的OnDestroy方法，我们可以在UGameplayTasksComponent::OnGameplayTaskDeactivated中看到非常多的移除方法：

```cpp
if (Task.IsTickingTask())
{
    // If we are removing our last ticking task, set this component as inactive so it stops ticking
    TickingTasks.RemoveSingleSwap(&Task);
}

// ...

if (!Task.IsOwnedByTasksComponent() && !Task.HasOwnerFinished() && TaskOwner)
{
    TaskOwner->OnGameplayTaskDeactivated(Task);
}
```

查看其中的Ability，重写了该方法：

```cpp
void UGameplayAbility::OnGameplayTaskDeactivated(UGameplayTask& Task)
{
    ActiveTasks.Remove(&Task);
}
```

当任务结束后，会移除引用：

```cpp
TArray<TObjectPtr<UGameplayTask>> ActiveTasks;
```

这样将所有的强引用去掉后，便等待GC的回收
