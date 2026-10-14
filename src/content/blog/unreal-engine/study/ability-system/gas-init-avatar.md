---
title: "ASC——状态归属、初始化与 Avatar 生命周期"
description: ""
publishedAt: 2026-10-14
tags: ["Unreal Engine","Ability System","source-reading"]
draft: false
---

本文章仅代表我个人在学习过程中的总结与思考，如有错误欢迎联系我进行更正。

## OwnerActor 与 AvatarActor

OwnerActor表示谁来持有这个 AbilitySystemComponent，AvatarActor是承担表现职责的 Actor，例如：

| 方案                 | OwnerActor     | AvatarActor    | 生命周期含义                                                 |
| -------------------- | -------------- | -------------- | ------------------------------------------------------------ |
| ASC 放在 Character   | 当前 Character | 当前 Character | 身体销毁通常连 ASC、授予记录与效果一起结束                   |
| ASC 放在 PlayerState | PlayerState    | 当前 Character | ASC 可跨 Pawn 更换存在；哪些能力、效果和属性保留仍需项目规则 |

## 初始化

在能力组件初始化阶段，简单概括下来就是：

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

>  这里补充一下，什么是 Outer？
>
> 专业解释为：`Outer` 表示一个 `UObject` 在引擎对象层级中的外部归属对象。
> 简单立即为：这个 UObject 是挂在哪个 UObject 名下创建的。
>
> ```cpp
> // Character 作为组件的 Outer
> UInventoryComponent* Inventory = NewObject<UInventoryComponent>(Character);
> ```
>
> 
> 更近一步，Outer和Owner的区别是？
>
> - Outer（对象归属）：`UObject` 层面的概念，表示对象在 UE 对象层级中归属于哪个对象。
> - Owner（逻辑所有者）：主要用于 `Actor` 和 `ActorComponent`，表示对象在游戏逻辑中的所属关系。

## InitAbilityActorInfo

重点看一下InitAbilityActorInfo发生了什么：

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

1. 先比较当前作为表现层的角色Avatar和旧的Avatar是否是一致。

2. `InitFromActor()` 会根据传入的 Owner、Avatar 和 ASC，重新填充 `FGameplayAbilityActorInfo` 中的上下文信息。

3. 同步组件自身维护的 Avatar。

4. 处理延迟执行的 GameplayCue。

  这里主要处理的目的是一个网络延迟的问题。例如，客户端先收到了 GameplayEffect 的复制数据，但是当前 AbilitySystemComponent 还没有关联到这个 Character，所以对于 GameplayCue 的处理需要延后进行。因此在设置 Avatar 之后，便可处理延迟执行的 GameplayCue。

5. Avatar 变化时，通过 OnAvatarSet 通知所有已授予的 Ability。该方法可后续在Ability的介绍中查看。

6. 注册 GameplayTag 响应表。// TODO

7. 重置 Montage 状态。

8. 处理接受但还未执行的 Montage 复制。

## 具体例子

设 PlayerState 上的 ASC 保留，旧身体 Pawn_A 死亡，Pawn_B 重生。以下是项目应设计的顺序，不是引擎替你完成的事务：

1. 在旧身体仍可访问时，结束依赖它的任务，解除输入与 UI 的旧绑定。记录哪些冷却要延续、哪些负面 GE 要删除。
2. 服务器 possession 新身体，获得 PlayerState 与 ASC，设置 Owner=PlayerState、Avatar=Pawn_B。
3. 按规则重置生命；“把 Avatar 换成 Pawn_B”本身不修改 Health。
4. 客户端在 PlayerState 可用后刷新自己的 ActorInfo；输入只绑定一次到当前 ASC。客户端收到授予列表的时间可能晚于 ActorInfo 初始化。
5. UI 先读当前 Health，再监听变化，避免绑定后没有新变化时仍显示旧血量。

ClearActorInfo 清空 Owner、Avatar、Controller、Mesh、Movement 缓存，通常发生在 Avatar发生变化的时候。

