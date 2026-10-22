---
title: "GAS 中的 UI 观察、配置资源"
description: "本文介绍 Gameplay Ability System 中 UI 所应承担的职责。"
publishedAt: 2026-10-22
tags: ["Unreal Engine","Ability System","source-reading"]
draft: false
---

## UI 只负责观察，不应负责仲裁

根据 AttributeSet 查询，委托通过一个 TMap 来维护：

```cpp
TMap<FGameplayAttribute, FOnGameplayAttributeValueChange> AttributeValueChangeDelegates;

FOnGameplayAttributeValueChange& UAbilitySystemComponent::GetGameplayAttributeValueChangeDelegate(FGameplayAttribute Attribute)
{
	return ActiveGameplayEffects.GetGameplayAttributeValueChangeDelegate(Attribute);
}
```

InternalUpdateNumericalAttribute 做两件事：写旧值、新值，再广播出去：

```cpp
void FActiveGameplayEffectsContainer::InternalUpdateNumericalAttribute(FGameplayAttribute Attribute, float NewValue, const FGameplayEffectModCallbackData* ModData, bool bFromRecursiveCall)
{
	const float OldValue = Owner->GetNumericAttribute(Attribute);

	Owner->SetNumericAttribute_Internal(Attribute, NewValue);
	
	if (!bFromRecursiveCall)
	{
		// We should only have one: either cached CurrentModcallbackData, or explicit callback data passed directly in.
		if (ModData && CurrentModcallbackData)
		{
			UE_LOG(LogGameplayEffects, Warning, TEXT("Had passed in ModData and cached CurrentModcallbackData in FActiveGameplayEffectsContainer::InternalUpdateNumericalAttribute. For attribute %s on %s."), *Attribute.GetName(), *Owner->GetFullName() );
		}
		
		const FGameplayEffectModCallbackData* DataToShare = ModData ? ModData : CurrentModcallbackData;

		// DEPRECATED Delegate
		PRAGMA_DISABLE_DEPRECATION_WARNINGS
		if (FOnGameplayAttributeChange* LegacyDelegate = AttributeChangeDelegates.Find(Attribute))
		{
			LegacyDelegate->Broadcast(NewValue, DataToShare);
		}
		PRAGMA_ENABLE_DEPRECATION_WARNINGS

		// NEW Delegate
		if (FOnGameplayAttributeValueChange* NewDelegate = AttributeValueChangeDelegates.Find(Attribute))
		{
			FOnAttributeChangeData CallbackData;
			CallbackData.Attribute = Attribute;
			CallbackData.NewValue = NewValue;
			CallbackData.OldValue = OldValue;
			CallbackData.GEModData = DataToShare;
			NewDelegate->Broadcast(CallbackData);
		}
	}
	CurrentModcallbackData = nullptr;
}
```

GEModData 存放着：

```cpp
const struct FGameplayEffectSpec&		EffectSpec;		// The spec that the mod came from

struct FGameplayModifierEvaluatedData&	EvaluatedData;	// The 'flat'/computed data to be applied to the target

class UAbilitySystemComponent &Target;		// Target we intend to apply to
```

因此 UI 只需要订阅 FOnGameplayAttributeValueChange 即可了解数值的变化。一次完整的观察流程如下：

```cpp
开始观察当前角色
→ 解除旧 ASC 的属性/标签/效果委托
→ 绑定当前 ASC，保存对应委托 Handle
→ 查询 Health、MaxHealth、Mana、MaxMana、当前标签与冷却初值
→ 首次绑定后，需主动查询一次属性
→ 属性变化刷新数值
→ 关闭/切 Pawn/重生时结束观察
```

### 一次观察会话应该保存什么

1. 保存当前 ASC 的**弱引用**，观察者不应该影响 ASC 的生命周期。
2. Attribute 的各自 DelegateHandle，它负责跟踪本次订阅，在更换观察目标时，方便解除绑定。

对于异步加载的内容，如技能图标，若此时已经更换了观察对象，技能图标可能已经不同，因此需要借助 SessionId 来区分是否还适用，是否应当继续展示。

### 为什么在订阅属性变化事件后，需要主动查询一次？

角色出生时，属性初始化通常由 GameplayEffect 赋予属性 `FActiveGameplayEffectsContainer::SetAttributeBaseValue(FGameplayAttribute Attribute, float NewBaseValue)`。若 UI 绑定发生在赋予属性之后，单纯订阅属性的变化不会拿到角色的属性值。
