---
title: "AActor、APawn、ACharacter 源码解读"
description: ""
publishedAt: 2026-09-22
tags:
  - Unreal Engine
  - 源码解读
draft: false
---

本文由AI与个人理解结合而成，若有错误还望指出~

## AActor

头文件：

```
Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h
```

官方对它最核心的定义是：

> 可以被放置到 Level 中，或者 Spawn 到世界中的对象。

### 1. 世界中的身份

继承关系如下：

```cpp
class AActor : public UObject
```

`UObject` 本身不是一个“世界实体”，而 `AActor`：

```
UWorld
ULevel
AActor
```

开始拥有明确的 World / Level 上下文。

### 2. Transform 与场景层级

Actor 本身并不真正保存完整的场景 Transform 实现，而是通过：

```cpp
USceneComponent* RootComponent;
```

建立自己的空间表示。因此可以看到对外提供和场景有关的方法：

```cpp
/*
注意，Transform 来自 USceneComponent
*/

GetActorLocation()
GetActorRotation()
GetActorTransform()

SetActorLocation()
SetActorRotation()
SetActorTransform()
```

### 3. Component 容器 / 聚合者

Actor 是一组 Component 的宿主，因此可以看到不少相关的方法：

```cpp
/** Searches components array and returns first encountered component of the specified class, native version of GetComponentByClass */
ENGINE_API virtual UActorComponent* FindComponentByClass(const TSubclassOf<UActorComponent> ComponentClass) const;


/**
 * 获取所有派生自指定 ComponentClass 的组件，并将结果填充到 OutComponents 数组中。
 * 建议使用带有 TInlineAllocator 的 TArray，这样有可能避免内存分配的开销。
 * TInlineComponentArray 就是为了让这个操作更方便而定义的，举个例子：
 * {
 *     TInlineComponentArray<UPrimitiveComponent*> PrimComponents(Actor);
 * }
 *
 * @param ComponentClass            要查找的组件类（会找出所有派生自该类的组件）
 * @param bIncludeFromChildActors   如果为 true，则会递归进入 ChildActor 组件，并在那些 Actor 中同样查找相应类型的组件
 */
template<class AllocatorType, class ComponentType>
void GetComponents(TSubclassOf<UActorComponent> ComponentClass, TArray<ComponentType*, AllocatorType>& OutComponents, bool bIncludeFromChildActors = false) const
{
    OutComponents.Reset();
    ForEachComponent_Internal<ComponentType>(ComponentClass, bIncludeFromChildActors, [&](ComponentType* InComp)
    {
        OutComponents.Add(InComp);
    });
}


/** Adds a component to the instance components array */
ENGINE_API void AddInstanceComponent(UActorComponent* Component);

/** Removes a component from the instance components array */
ENGINE_API void RemoveInstanceComponent(UActorComponent* Component);

/** Clears the instance components array */
ENGINE_API void ClearInstanceComponents(bool bDestroyComponents);
```

>**这里补充一个和性能相关的点：**
>
>关于 `TInlineAllocator`：注释里特意强调了推荐用它，主要是为了性能优化。
>
>在 UE 开发里，如果用默认的 `HeapAllocator`，每次 `Add` 都可能触发堆内存分配；而用 `TInlineAllocator` 可以在栈上预留一小块空间，对于这种临时遍历组件的场景，能省下不少内存分配的开销。

### 4. 生命周期

典型流程：

```
构造
 ↓
PostLoad / Spawn
 ↓
OnConstruction
 ↓
PreInitializeComponents
 ↓
InitializeComponent
 ↓
PostInitializeComponents
 ↓
BeginPlay
 ↓
Tick
 ↓
EndPlay
 ↓
Destroyed
```

`AActor` 负责定义“世界实体从出生到死亡”的生命周期协议。因此BeginPlay、Tick、EndPlay不是 `UObject` 的职责。

### 5. Spawn / Destroy

在世界创建Actor对象：

```cpp
World->SpawnActor<AActor>()
```

销毁Actor对象：

```
Destroy()

退出 World / Actor 生命周期
       ↓
进入待销毁状态
       ↓
最后由 UObject GC 回收内存
```

### 6. Tick

Actor 提供：

```cpp
UPROPERTY(EditDefaultsOnly, Category=Tick)
struct FActorTickFunction PrimaryActorTick;

/** 
 *	Function called every frame on this Actor. Override this function to implement custom logic to be executed every frame.
 *	Note that Tick is disabled by default, and you will need to check PrimaryActorTick.bCanEverTick is set to true to enable it.
 *
 *	@param	DeltaSeconds	Game time elapsed during last frame modified by the time dilation
 */
ENGINE_API virtual void Tick( float DeltaSeconds );
```

> Actor 支持 Tick，不代表 Actor 必须 Tick，可通过 PrimaryActorTick.bCanEverTick 启动或关闭。

### 7. 网络复制

这是 `AActor` 特别大的一个职责。

主要包括：

```
bReplicates
bNetLoadOnClient
NetDormancy
NetUpdateFrequency
Role / RemoteRole 相关逻辑
```

以及 RPC / Property Replication 的宿主。

- UObject不天然是一个网络实体
- AActor是 UE 网络复制体系中的核心网络实体

### 8.  Owner / Instigator

Actor 还建立了一些非常核心的 Gameplay 关系：

```
Owner
Instigator
```

例如：

```
玩家 Character
    ↓ 发射
Projectile
    ↓
Instigator = Character
Owner = Weapon / Character
```

主要用于：伤害来源、权限关系、网络相关性、Gameplay 查询。

## APawn

头文件：

```cpp
Engine/Source/Runtime/Engine/Classes/GameFramework/Pawn.h
```

Pawn 是所有能够被玩家或 AI Possess 的 Actor 的基类。

```cpp
class APawn : public AActor, public INavAgentInterface
```

### 1. Controller / Possession

核心关系：

```
AController
     │
     │ Possess
     ▼
   APawn
```

在 `Pawn.h` 可以看到：

```cpp
/** Controller currently possessing this Actor */
UPROPERTY(replicatedUsing=OnRep_Controller)
TObjectPtr<AController> Controller;

/** 
 * Called when this Pawn is possessed. Only called on the server (or in standalone).
 * @param NewController The controller possessing this pawn
 */
ENGINE_API virtual void PossessedBy(AController* NewController);

/** Called when our Controller no longer possesses us. Only called on the server (or in standalone). */
ENGINE_API virtual void UnPossessed();
```

### 控制对象切换过程

切换主要由 `AController` 发起：

```cpp
/**
* 负责将此控制器附加（附身）到指定的 Pawn 上。
* 仅在网络权威端运行（即 HasAuthority() 返回 true 的情况下）。
* 派生的原生类（C++类）可以重写 OnPossess 方法，以对指定的 Pawn 进行过滤或处理。
* 当被附身的 Pawn 发生变更时，蓝图类会通过 ReceivePossess 收到通知，同时 OnNewPawn 委托（Delegate）也会被广播。
* @param InPawn 将要被附身的 Pawn。
* @see HasAuthority, OnPossess, ReceivePossess
*/
UFUNCTION(BlueprintCallable, BlueprintAuthorityOnly, Category=Pawn, meta=(Keywords="set controller"))
ENGINE_API virtual void Possess(APawn* InPawn) final; // DEPRECATED(4.22, "Possess is marked virtual final as you should now be overriding OnPossess instead")
```

切换时会校验权威性，拓展点在 `OnPossess`，简单来说，代码逻辑如下：

```cpp
void AController::OnPossess(APawn* InPawn)
{
	InPawn->PossessedBy(this);
	SetPawn(InPawn);

	// update rotation to match possessed pawn's rotation
	SetControlRotation(Pawn->GetActorRotation());

    // 该方法用于处理Pawn的一些状态，例如停止当前移动、清除待处理移动输入、重新计算视点高度
	Pawn->DispatchRestart(false);
}
```

`APlayerController` 对该方法进行了重写，在原来的基础上增加了网络预测重置、相机管理:

```cpp
if (NetworkPredictionInterface)
{
    NetworkPredictionInterface->ResetPredictionData_Server();
}

if (bAutoManageActiveCameraTarget)
{
    AutoManageActiveCameraTarget(GetPawn());
    ResetCameraMode();
}
```

`AAIController` 增加了寻路初始化、GameplayTasks组件、黑板键的加载、Brain组件的启动：

```cpp
if (PathFollowingComponent)
{
    PathFollowingComponent->Initialize();
}

if (CachedGameplayTasksComponent == nullptr)
{
    UGameplayTasksComponent* GTComp = InPawn->FindComponentByClass<UGameplayTasksComponent>();
    if (GTComp == nullptr)
    {
        GTComp = NewObject<UGameplayTasksComponent>(InPawn, TEXT("GameplayTasksComponent"));
        GTComp->RegisterComponent();
    }
    CachedGameplayTasksComponent = GTComp;
}

if (Blackboard && Blackboard->GetBlackboardAsset())
{
    InitializeBlackboard(*Blackboard, *Blackboard->GetBlackboardAsset());
}

if (bStartAILogicOnPossess && BrainComponent)
{
    BrainComponent->StartLogic();
}
```



### 3. 玩家控制 / AI 控制身份

Pawn 会提供很多类似：

```cpp
/** Returns true if controlled by a local (not network) Controller.	 */
UFUNCTION(BlueprintPure, Category=Pawn)
ENGINE_API virtual bool IsLocallyControlled() const;
    
/** Returns true if controlled by a human player (possessed by a PlayerController).	This returns true for players controlled by remote clients */
UFUNCTION(BlueprintPure, Category=Pawn)
ENGINE_API virtual bool IsPlayerControlled() const;

/** Returns true if controlled by a bot.	 */
UFUNCTION(BlueprintPure, Category = Pawn)
ENGINE_API virtual bool IsBotControlled() const;
```

### 3. Input

Pawn 开始和输入系统建立关系。

```cpp
/** Allows a Pawn to set up custom input bindings. Called upon possession by a PlayerController, using the InputComponent created by CreatePlayerInputComponent(). */
virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) { /* No bindings by default.*/ }
```

### 4. Movement 抽象

Pawn 开始出现：

```cpp
/** Return our PawnMovementComponent, if we have one. By default, returns the first PawnMovementComponent found. Native classes that create their own movement component should override this method for more efficiency. */
UFUNCTION(BlueprintCallable, meta=(Tooltip="Return our PawnMovementComponent, if we have one."), Category=Pawn)
ENGINE_API virtual UPawnMovementComponent* GetMovementComponent() const;
```

> 需要注意：
>
> `APawn` 自身不会创建或保存一个默认的 `UPawnMovementComponent`；
>
> `ACharacter` 构造时创建 `UCharacterMovementComponent`，并重写 getter，直接返回 `CharacterMovement`。

在传送、出生点设置、编辑器工具或一次性位置修正，可使用SetActorLocation调整位置，但若是Pawn持续移动时，应当避免使用SetActorLocation，通常移动组件会处理输入消费、碰撞处理、移动模式、网络同步等等。

因此借助`AddMovementInput` 由 MovementComponent 计算并执行最终移动。

```cpp
/**
 * 沿给定的世界空间方向向量（通常为单位向量）添加移动输入，并按 'ScaleValue' 进行缩放。
 * 如果 ScaleValue < 0，移动将沿相反方向进行。
 *
 * 基础的 Pawn 类不会自动应用移动，需要用户在 Tick 事件中自行处理。
 * 而诸如 Character 和 DefaultPawn 等子类会自动处理该输入并移动。
 *
 * @param WorldDirection	要应用输入的世界空间方向
 * @param ScaleValue		应用于输入的缩放值。可用于模拟量输入，例如 0.5 表示正常值的一半，-1.0 表示反向。
 * @param bForce			如果为 true，则始终添加输入，忽略 IsMoveInputIgnored() 的返回结果。
 * @see GetPendingMovementInputVector(), GetLastMovementInputVector(), ConsumeMovementInputVector()
 */
UFUNCTION(BlueprintCallable, Category="Pawn|Input", meta=(Keywords="AddInput"))
ENGINE_API virtual void AddMovementInput(FVector WorldDirection, float ScaleValue = 1.0f, bool bForce = false);


void APawn::AddMovementInput(FVector WorldDirection, float ScaleValue, bool bForce /*=false*/)
{
	UPawnMovementComponent* MovementComponent = GetMovementComponent();
	if (MovementComponent)
	{
		MovementComponent->AddInputVector(WorldDirection * ScaleValue, bForce);
	}
	else
	{
		Internal_AddMovementInput(WorldDirection * ScaleValue, bForce);
	}
}
```

每次有新的输入，都会将数据传递给`APawn::ControlInputVector`：

```cpp
void APawn::Internal_AddMovementInput(FVector WorldAccel, bool bForce /*=false*/)
{
	if (bForce || !IsMoveInputIgnored())
	{
		ControlInputVector += WorldAccel;
	}
}
```

在UCharacterMovementComponent::TickComponent中，会每帧消费`ControlInputVector` 的输入（普通同步移动时）：

```cpp
FVector InputVector = FVector::ZeroVector;
bool bUsingAsyncTick = (CharacterMovementCVars::AsyncCharacterMovement == 1) && IsAsyncCallbackRegistered();
if (!bUsingAsyncTick)
{
    // Do not consume input if simulating asynchronously, we will consume input when filling out async inputs.
    InputVector = ConsumeInputVector();
}
```

对应就是：

```cpp
FVector APawn::Internal_ConsumeMovementInputVector()
{
	LastControlInputVector = ControlInputVector;
	ControlInputVector = FVector::ZeroVector;
	return LastControlInputVector;
}
```



### 5. Navigation Agent

源码声明里你会直接看到：

```cpp
class APawn : public AActor, public INavAgentInterface
```

### 6. View / Camera 基础接口

相关的一些基础抽象，例如：

```cpp
/**
 * Get the view rotation of the Pawn (direction they are looking, normally Controller->ControlRotation).
 * @return The view rotation of the Pawn.
 */
ENGINE_API virtual FRotator GetViewRotation() const;
```

## ACharacter

头文件：

```
Engine/Source/Runtime/Engine/Classes/GameFramework/Character.h
```

Character 是拥有 Mesh、Collision 和内置移动逻辑的 Pawn，主要面向直立角色，可以走、跳、飞、游泳。

### 1. Capsule Collision

Character 默认建立`UCapsuleComponent`作为主要碰撞体。

结构大概可以先记成：

```
ACharacter
│
├── CapsuleComponent   ← Root / 主碰撞
│
├── SkeletalMeshComponent
│
└── CharacterMovementComponent
```

### 2.  Skeletal Mesh

Character 自带：

```cpp
USkeletalMeshComponent* Mesh;
```

也就是说 UE 默认 Character ≈ 有动画骨骼的人形角色，而 Pawn 没有。

### 3. CharacterMovementComponent

 `ACharacter` 持有 UCharacterMovementComponent。

### 4. Jump

```cpp
/** 
 * 在下一帧更新时让角色跳跃。
 * 如果你希望角色的跳跃效果根据跳跃键按下的时长来变化，
 * 那么可以将 JumpMaxHoldTime 设置为一个非零值。在这种情况下，请确保
 * 在希望停止施加跳跃 Z 轴速度时调用 StopJumping()（例如在按键抬起事件中），
 * 否则角色将持续接收该速度，直到 JumpKeyHoldTime 达到 JumpMaxHoldTime。
 */
UFUNCTION(BlueprintCallable, Category=Character)
ENGINE_API virtual void Jump();

/** 
 * 在下一帧更新时让角色停止跳跃。
 * 请在输入事件（例如按键“抬起”事件）中调用此函数，以停止施加
 * 跳跃 Z 轴速度。如果不调用此函数，跳跃 Z 轴速度将持续施加，
 * 直到达到 JumpMaxHoldTime。
 */
UFUNCTION(BlueprintCallable, Category=Character)
ENGINE_API virtual void StopJumping();


/**
 * 检查角色在当前状态下是否可以跳跃。
 *
 * 默认实现可以通过在蓝图中实现自定义的 CanJump 事件来重写或扩展。
 * 
 * @Return 角色在当前状态下是否可以跳跃。
 */
UFUNCTION(BlueprintCallable, Category=Character)
ENGINE_API bool CanJump() const;


/**
 * 角色可以执行的最大跳跃次数。
 * 注意，如果 JumpMaxHoldTime 不为零且未调用 StopJumping，玩家
 * 可能会执行无限次跳跃。因此，通常在
 * 跳跃输入停止时（例如按键抬起事件）调用 StopJumping() 是最好的做法。
 */
UPROPERTY(EditAnywhere, BlueprintReadWrite, Replicated, Category=Character)
int32 JumpMaxCount;

/**
 * 追踪当前已执行的跳跃次数。
 * 该值在 CheckJumpInput 中递增，在 CanJump_Implementation 中使用，并在 OnMovementModeChanged 中重置。
 * 当重写这些方法时，建议手动递增/重置此值，或者调用 Super:: 方法。
 */
UPROPERTY(VisibleInstanceOnly, BlueprintReadOnly, Category=Character)
int32 JumpCurrentCount;
```

“跳跃”属于标准 Character 行为，而不是通用 Pawn 行为。

### 5. Crouch

类似地 Character / CharacterMovement 体系支持：

```
Crouch()
UnCrouch()
CanCrouch()
```

以及 Capsule 高度变化、网络同步等。

### 6. Root Motion

Character中也会处理一些Root Motion相关的内容。

## 小结

Actor、Component、Pawn、Character 的职责差异，以及如何避免角色类膨胀。

> Actor 是 World 中可放置、生成、销毁、可复制的实体，例如门、投射物；
>
> 
>
> Pawn 在 Actor 基础上增加了可被 Controller Possess 的语义，例如载具；
>
> 
>
> Character 是面向常规角色移动的 Pawn 实现，默认包含胶囊体、骨骼网格体、移动组件；
>
> 
>
> 组件通常伴随Owner存活，可按照职责划分组件，并挂载到角色身上，例如战斗组件、背包组件等等，这样可避免角色类膨胀；
