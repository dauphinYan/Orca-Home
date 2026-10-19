---
title: "Reading the Source: AActor, APawn, and ACharacter"
description: ""
publishedAt: 2026-09-22
tags:
  - Unreal Engine
  - source-reading
draft: false
---

This article combines AI assistance with my own understanding. Corrections are welcome!

## AActor

Header:

```
Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h
```

The central definition in the official documentation is:

> An object that can be placed in a Level or spawned into the world.

### 1. Identity in the World

The inheritance relationship is:

```cpp
class AActor : public UObject
```

`UObject` itself is not a “world entity.” `AActor`, however:

```
UWorld
ULevel
AActor
```

introduces a definite World / Level context.

### 2. Transform and Scene Hierarchy

Actor does not implement its complete scene transform directly. Instead, it uses:

```cpp
USceneComponent* RootComponent;
```

to represent its position and orientation in space. This is why it exposes scene-related methods such as:

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

### 3. Component Container / Aggregator

An Actor hosts a collection of Components and therefore provides many related methods:

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

> **A performance-related detail:**
>
> The comment specifically recommends `TInlineAllocator` for performance reasons.
>
> With the default `HeapAllocator`, an `Add` operation may trigger a heap allocation. `TInlineAllocator` reserves a small amount of storage inside the container itself; when the temporary container is on the stack, this can avoid heap allocations during component traversal.

### 4. Lifecycle

A typical flow is:

```
Construction
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

`AActor` defines the lifecycle of a world entity, from creation to destruction. `BeginPlay`, `Tick`, and `EndPlay` are therefore not responsibilities of `UObject`.

### 5. Spawn / Destroy

Creating an Actor in the world:

```cpp
World->SpawnActor<AActor>()
```

Destroying an Actor:

```
Destroy()

Exit the World / Actor lifecycle
       ↓
Enter the pending-destruction state
       ↓
UObject GC eventually reclaims the memory
```

### 6. Tick

Actor provides:

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

> Supporting Tick does not mean an Actor must tick. `PrimaryActorTick.bCanEverTick` controls whether it is allowed to tick.

### 7. Network Replication

This is one of `AActor`'s major responsibilities.

It includes:

```
bReplicates
bNetLoadOnClient
NetDormancy
NetUpdateFrequency
Role / RemoteRole logic
```

Actor also hosts RPCs and property replication.

- A UObject is not inherently a network entity.
- AActor is a core network entity in UE's replication system.

### 8.  Owner / Instigator

Actor also establishes some fundamental Gameplay relationships:

```
Owner
Instigator
```

For example:

```
Player Character
    ↓ fires
Projectile
    ↓
Instigator = Character
Owner = Weapon / Character
```

These are mainly used for damage attribution, ownership and authority relationships, network relevancy, and Gameplay queries.

## APawn

Header:

```cpp
Engine/Source/Runtime/Engine/Classes/GameFramework/Pawn.h
```

Pawn is the base class for Actors that can be possessed by a player or AI.

```cpp
class APawn : public AActor, public INavAgentInterface
```

### 1. Controller / Possession

The core relationship is:

```
AController
     │
     │ Possess
     ▼
   APawn
```

In `Pawn.h`, we find:

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

### Switching the Controlled Pawn

The switch is primarily initiated by `AController`:

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

Possession checks authority, and `OnPossess` is the extension point. In simplified form, the logic is:

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

`APlayerController` overrides this method, adding network prediction resets and camera management:

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

`AAIController` adds path-following initialization, a GameplayTasks component, Blackboard initialization, and startup of the Brain component:

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



### 3. Player-Controlled / AI-Controlled Identity

Pawn provides queries such as:

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

Pawn establishes a relationship with the input system.

```cpp
/** Allows a Pawn to set up custom input bindings. Called upon possession by a PlayerController, using the InputComponent created by CreatePlayerInputComponent(). */
virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) { /* No bindings by default.*/ }
```

### 4. Movement Abstraction

Pawn introduces:

```cpp
/** Return our PawnMovementComponent, if we have one. By default, returns the first PawnMovementComponent found. Native classes that create their own movement component should override this method for more efficiency. */
UFUNCTION(BlueprintCallable, meta=(Tooltip="Return our PawnMovementComponent, if we have one."), Category=Pawn)
ENGINE_API virtual UPawnMovementComponent* GetMovementComponent() const;
```

> Note:
>
> `APawn` itself neither creates nor stores a default `UPawnMovementComponent`.
>
> `ACharacter` creates a `UCharacterMovementComponent` in its constructor and overrides the getter to return `CharacterMovement` directly.

`SetActorLocation` is suitable for teleportation, spawn placement, editor tools, or one-off position corrections. For continuous Pawn movement, however, use a movement component, which normally handles input consumption, collision, movement modes, network synchronization, and more.

Use `AddMovementInput` to supply input, then let the MovementComponent calculate and perform the final movement.

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

Each new input contributes to `APawn::ControlInputVector`:

```cpp
void APawn::Internal_AddMovementInput(FVector WorldAccel, bool bForce /*=false*/)
{
	if (bForce || !IsMoveInputIgnored())
	{
		ControlInputVector += WorldAccel;
	}
}
```

During normal synchronous movement, `UCharacterMovementComponent::TickComponent` consumes `ControlInputVector` every frame:

```cpp
FVector InputVector = FVector::ZeroVector;
bool bUsingAsyncTick = (CharacterMovementCVars::AsyncCharacterMovement == 1) && IsAsyncCallbackRegistered();
if (!bUsingAsyncTick)
{
    // Do not consume input if simulating asynchronously, we will consume input when filling out async inputs.
    InputVector = ConsumeInputVector();
}
```

The corresponding implementation is:

```cpp
FVector APawn::Internal_ConsumeMovementInputVector()
{
	LastControlInputVector = ControlInputVector;
	ControlInputVector = FVector::ZeroVector;
	return LastControlInputVector;
}
```



### 5. Navigation Agent

The source declaration explicitly includes:

```cpp
class APawn : public AActor, public INavAgentInterface
```

### 6. Basic View / Camera Interfaces

Some basic abstractions include:

```cpp
/**
 * Get the view rotation of the Pawn (direction they are looking, normally Controller->ControlRotation).
 * @return The view rotation of the Pawn.
 */
ENGINE_API virtual FRotator GetViewRotation() const;
```

## ACharacter

Header:

```
Engine/Source/Runtime/Engine/Classes/GameFramework/Character.h
```

Character is a Pawn with a Mesh, collision, and built-in movement logic. It primarily targets upright characters that can walk, jump, fly, and swim.

### 1. Capsule Collision

Character creates a `UCapsuleComponent` as its main collision shape by default.

You can think of its structure as:

```
ACharacter
│
├── CapsuleComponent   ← Root / main collision
│
├── SkeletalMeshComponent
│
└── CharacterMovementComponent
```

### 2.  Skeletal Mesh

Character includes:

```cpp
USkeletalMeshComponent* Mesh;
```

In other words, UE's default Character roughly represents a humanoid with an animated skeleton; Pawn does not provide that by default.

### 3. CharacterMovementComponent

`ACharacter` owns a `UCharacterMovementComponent`.

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

Jumping is standard Character behavior rather than generic Pawn behavior.

### 5. Crouch

Similarly, the Character / CharacterMovement system supports:

```
Crouch()
UnCrouch()
CanCrouch()
```

along with capsule height changes, network synchronization, and related behavior.

### 6. Root Motion

Character also handles aspects of Root Motion.

## Summary

The responsibilities of Actor, Component, Pawn, and Character differ. Understanding them also helps prevent character classes from becoming bloated.

> Actor is an entity in the World that can be placed, spawned, destroyed, and replicated—for example, a door or projectile.
>
> 
>
> Pawn extends Actor with the ability to be possessed by a Controller—for example, a vehicle.
>
> 
>
> Character is a Pawn implementation for conventional character movement. It includes a capsule, skeletal mesh, and movement component by default.
>
> 
>
> Components usually live with their Owner. Split functionality into components by responsibility and attach them to the character—for example, combat and inventory components—to keep the character class manageable.
