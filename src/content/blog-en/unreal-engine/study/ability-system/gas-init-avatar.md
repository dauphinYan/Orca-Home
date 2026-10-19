---
title: "ASC: State Ownership, Initialization, and the Avatar Lifecycle"
description: ""
publishedAt: 2026-10-14
tags: ["Unreal Engine","Ability System","source-reading"]
draft: false
---

This article reflects my own notes and thoughts while learning. Please contact me if you spot an error.

## OwnerActor and AvatarActor

OwnerActor identifies the actor that owns the AbilitySystemComponent. AvatarActor is the actor responsible for its physical representation. For example:

| Setup | OwnerActor | AvatarActor | Lifecycle implications |
| --- | --- | --- | --- |
| ASC on Character | Current Character | Current Character | Destroying the body usually also ends the ASC, granted abilities, and effects |
| ASC on PlayerState | PlayerState | Current Character | The ASC can survive Pawn replacement; project rules still determine which abilities, effects, and attributes persist |

## Initialization

The ability component initialization process can be summarized as follows:

```cpp
// 获取组件宿主
AActor *Owner = GetOwner();

// 初始化默认上下文
InitAbilityActorInfo(Owner, Owner);

// 自动发现并注册挂在 Owner 名下的 AttributeSet
GetObjectsWithOuter(Owner, ChildObjects, false, RF_NoFlags, EInternalObjectFlags::Garbage);

// 将前面发现的 AttributeSet 保存
SpawnedAttributes.AddUnique(Set);
```

> What does Outer mean here?
>
> Formally, `Outer` is the object to which a `UObject` belongs in the engine's object hierarchy.
> Put simply, it identifies the UObject under which this UObject was created.
>
> ```cpp
> // Character 作为组件的 Outer
> UInventoryComponent* Inventory = NewObject<UInventoryComponent>(Character);
> ```
>
> How does Outer differ from Owner?
>
> - Outer (object containment): a `UObject` concept that identifies the containing object in the UE object hierarchy.
> - Owner (logical ownership): used mainly by `Actor` and `ActorComponent` to express ownership in game logic.

## InitAbilityActorInfo

Let's examine what happens inside InitAbilityActorInfo:

```cpp
void UAbilitySystemComponent::InitAbilityActorInfo(AActor* InOwnerActor, AActor* InAvatarActor)
{
	check(AbilityActorInfo.IsValid());
	bool WasAbilityActorNull = (AbilityActorInfo->AvatarActor == nullptr);
	bool AvatarChanged = (InAvatarActor != AbilityActorInfo->AvatarActor);

	AbilityActorInfo->InitFromActor(InOwnerActor, InAvatarActor, this);

	SetOwnerActor(InOwnerActor);

	// caching the previous value of the actor so we can check against it but then setting the value to the new because it may get used
	const AActor* PrevAvatarActor = GetAvatarActor_Direct();
	SetAvatarActor_Direct(InAvatarActor);

	// if the avatar actor was null but won't be after this, we want to run the deferred gameplaycues that may not have run in NetDeltaSerialize
	// Conversely, if the ability actor was previously null, then the effects would not run in the NetDeltaSerialize. As such we want to run them now.
	if ((WasAbilityActorNull || PrevAvatarActor == nullptr) && InAvatarActor != nullptr)
	{
		HandleDeferredGameplayCues(&ActiveGameplayEffects);
	}

	if (AvatarChanged)
	{
		ABILITYLIST_SCOPE_LOCK();
		for (FGameplayAbilitySpec& Spec : ActivatableAbilities.Items)
		{
			if (Spec.Ability)
			{
				if (Spec.Ability->GetInstancingPolicy() == EGameplayAbilityInstancingPolicy::InstancedPerActor)
				{
					UGameplayAbility* AbilityInstance = Spec.GetPrimaryInstance();
					// If we don't have the ability instance, it was either already destroyed or will get called on creation
					if (AbilityInstance)
					{
						AbilityInstance->OnAvatarSet(AbilityActorInfo.Get(), Spec);
					}
				}
				else
				{
					Spec.Ability->OnAvatarSet(AbilityActorInfo.Get(), Spec);
				}
			}
		}
	}

	if (UGameplayTagReponseTable* TagTable = UAbilitySystemGlobals::Get().GetGameplayTagResponseTable())
	{
		TagTable->RegisterResponseForEvents(this);
	}
	
	LocalAnimMontageInfo = FGameplayAbilityLocalAnimMontage();
	if (IsOwnerActorAuthoritative())
	{
		SetRepAnimMontageInfo(FGameplayAbilityRepAnimMontage());
	}

	if (bPendingMontageRep)
	{
		OnRep_ReplicatedAnimMontage();
	}
}
```

1. Compare the incoming Avatar, which represents the physical character, with the previous Avatar.
2. `InitFromActor()` repopulates the context in `FGameplayAbilityActorInfo` using the supplied Owner, Avatar, and ASC.
3. Update the Avatar reference maintained by the component itself.
4. Process deferred GameplayCues.

   This primarily addresses network timing. A client may receive replicated GameplayEffect data before its AbilitySystemComponent is associated with the Character, so GameplayCue handling must be deferred. Once the Avatar is set, those deferred GameplayCues can be processed.

5. When the Avatar changes, notify all granted abilities through OnAvatarSet. This method will be covered in a later article about abilities.
6. Register the GameplayTag response table. // TODO
7. Reset Montage state.
8. Process Montage replication that has been received but not yet handled.

## A Concrete Example

Suppose the ASC on PlayerState persists, the old body Pawn_A dies, and Pawn_B respawns. The following sequence must be designed by the project; the engine does not perform it as an automatic transaction:

1. While the old body is still accessible, end tasks that depend on it and remove its input and UI bindings. Record which cooldowns should persist and which negative GEs should be removed.
2. The server possesses the new body, obtains PlayerState and the ASC, and sets Owner=PlayerState and Avatar=Pawn_B.
3. Reset Health according to project rules. Changing the Avatar to Pawn_B does not itself modify Health.
4. Once PlayerState is available, the client refreshes its ActorInfo. Bind input to the current ASC only once. The granted ability list may arrive on the client after ActorInfo initialization.
5. Have the UI read the current Health before subscribing to changes, so it does not continue showing the old value when no new change occurs after binding.

ClearActorInfo clears the cached Owner, Avatar, Controller, Mesh, and Movement references. It is typically used when the Avatar changes.
