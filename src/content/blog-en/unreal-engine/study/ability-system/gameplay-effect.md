---
title: "GameplayEffect: Definitions, Application Parameters, Context, and Attribute Capture"
description: ""
publishedAt: 2026-10-14
tags: ["Unreal Engine","Ability System","source-reading"]
draft: false
---

## The GE Class Defines Rules; the Spec Holds Parameters for an Application

Build a Spec through MakeOutgoingSpec:

```cpp
FGameplayEffectSpecHandle UAbilitySystemComponent::MakeOutgoingSpec(TSubclassOf<UGameplayEffect> GameplayEffectClass, float Level, FGameplayEffectContextHandle Context) const
{
	SCOPE_CYCLE_COUNTER(STAT_GetOutgoingSpec);
	if (Context.IsValid() == false)
	{
		Context = MakeEffectContext();
	}

	if (GameplayEffectClass)
	{
		UGameplayEffect* GameplayEffect = GameplayEffectClass->GetDefaultObject<UGameplayEffect>();

		FGameplayEffectSpec* NewSpec = new FGameplayEffectSpec(GameplayEffect, Context, Level);
		return FGameplayEffectSpecHandle(NewSpec);
	}

	return FGameplayEffectSpecHandle(nullptr);
}
```

- The GE CDO is a shared definition.
- Runtime differences, such as level, context, SetByCaller values, and captured data, are stored in the Spec.

FGameplayEffectSpecHandle manages its Data through a TSharedPtr. Copying a Handle therefore shares the same Data. Be explicit about whether each target needs an independent Spec.

```cpp
FGameplayEffectSpecHandle::FGameplayEffectSpecHandle(FGameplayEffectSpec* DataPtr) : Data(DataPtr)
    
TSharedPtr<FGameplayEffectSpec>	Data;
```

## The Three Duration Policies

| Configuration | Typical use | Attribute behavior | Meaning of removal |
| --- | --- | --- | --- |
| Instant | One-time damage, healing, standard costs | Execute Modifiers/Executions to change Base | Usually leaves no removable active record; removal cannot refund it |
| HasDuration, Period=0 | A 3-second cooldown or 5-second speed boost | Active modifiers contribute to Current aggregation; may grant only tags | Expiration removes modifier and tag contributions |
| Infinite, Period=0 | Equipment passives, persistent auras | Similar to duration effects, without automatic expiration | Removed explicitly by rules such as unequipping or dispelling |
| HasDuration/Infinite, Period>0 | Burning, periodic regeneration | Execute each period to modify Base | Removal stops future executions without restoring health already lost |

First distinguish **non-periodic GEs (Period = 0)** from **periodic GEs (Period > 0)**.

A buff that lasts 5 seconds and grants +50 Attack Power is a non-periodic GE:

```cpp
DurationPolicy = HasDuration;
Period = 0;
```

GAS adds this Modifier to the attribute Aggregator, where it contributes to CurrentValue.

- Initial BaseValue = 100
- While the buff is active: CurrentValue = 150
- After the buff is removed: CurrentValue = 100

A burning effect that lasts 5 seconds and removes 10 Health every second is a periodic GE:

```cpp
DurationPolicy = HasDuration;
Period = 1.0f;
```

GAS does not add this damage Modifier to the attribute Aggregator as a persistent modifier. Instead, it executes the Modifier whenever the period triggers.

- First execution: BaseValue = 90
- Second execution: BaseValue = 80
- Third execution: BaseValue = 70

Removing the burn does not restore BaseValue to 100.

> **Why distinguish BaseValue from CurrentValue?**
>
> Suppose a character has 100 Attack Power.
>
> 1. Buff A grants +50%, raising it to 150.
> 2. Buff B grants +20%, raising it to 170, assuming both bonuses are calculated from the base value.
> 3. Buff A expires, so its +50% contribution must be removed.
>
> How much Attack Power should remain? The correct answer is 120.
>
> If the system stored only a single Attack Power value of 170, correctly undoing Buff A would be much more complicated.
>
> GAS separates an attribute into two layers:
>
> - `BaseValue`: the base value, recording changes to the attribute itself.
> - `CurrentValue`: the final result after aggregating all currently effective Modifiers.
>
> | Operation | BaseValue | CurrentValue |
> | --- | --- | --- |
> | Initial Attack Power | 100 | 100 |
> | Gain Buff A (+50%) | 100 | 150 |
> | Gain Buff B (+20%) | 100 | 170 |
> | Permanently increase base Attack Power by 20 | 120 | 204 |
> | Buff A expires | 120 | 144 |
> | Buff B expires | 120 | 120 |
>
> This makes the final value straightforward to calculate correctly.

## Applying an Effect and Handling Failure

ApplyGameplayEffectSpecToTarget ultimately calls ApplyGameplayEffectSpecToSelf on the target ASC:

```cpp
FActiveGameplayEffectHandle UAbilitySystemComponent::ApplyGameplayEffectSpecToSelf(const FGameplayEffectSpec &Spec, FPredictionKey PredictionKey)
```

The method first acquires a lock. While a GE is being applied, callbacks could add or remove other GEs, potentially reallocating the internal TArray and invalidating existing pointers:

```cpp
FScopedActiveGameplayEffectLock ScopeLock(ActiveGameplayEffects);
```

For example:

1. GE_A is being applied, and `AppliedEffect` has been obtained.
2. A callback from GE_A adds GE_B to the same ASC.
3. If the internal `TArray` reallocates, GE_A's address may change.
4. The outer function would then access stale memory through its original `AppliedEffect` or `OurCopyOfSpec` pointers.

Next, it checks authorization: whether network authority is present or client prediction is permitted.

```cpp
// Check Network Authority
if (!HasNetworkAuthorityToApplyGameplayEffect(PredictionKey))
{
    return FActiveGameplayEffectHandle();
}
```

> Why allow client prediction?
>
> A player expects mana to be deducted immediately after pressing an ability button. Waiting for a server response would delay that feedback. GAS allows the client to predict the application first, then reconcile it with the server result using a prediction key.

Next, **prediction is excluded for periodic GEs**:

```cpp
// Don't allow prediction of periodic effects
if (PredictionKey.IsValidKey() && Spec.GetPeriod() > 0.f)
{
    if (IsOwnerActorAuthoritative())
    {
        // Server continue with invalid prediction key
        PredictionKey = FPredictionKey();
    }
    else
    {
        // Client just return now
        return FActiveGameplayEffectHandle();
    }
}
```

The current mechanism supports predicting a single application, rather than subsequent periodic changes.

ApplicationQuery and the CanApply checks of GE Components are then evaluated to determine whether the GE is blocked.

A predicted Instant effect is temporarily treated as Infinite:

```cpp
// Clients should treat predicted instant effects as if they have infinite duration. The effects will be cleaned up later.
bool bTreatAsInfiniteDuration = GetOwnerRole() != ROLE_Authority && PredictionKey.IsLocalClientKey() && Spec.Def->DurationPolicy == EGameplayEffectDurationType::Instant;
```

Treating an Instant as Infinite makes it **easier to roll back** if client prediction fails.

Next, the method determines where OurCopyOfSpec will be stored. Duration effects, Infinite effects, and predicted Instant effects require an active GE instance. If an existing stackable GE is found (bFoundExistingStackableGE), its existing instance is updated instead:

```cpp
if (Spec.Def->DurationPolicy != EGameplayEffectDurationType::Instant || bTreatAsInfiniteDuration)
{
    AppliedEffect = ActiveGameplayEffects.ApplyGameplayEffectSpec(Spec, PredictionKey, bFoundExistingStackableGE);
    if (!AppliedEffect)
    {
        return FActiveGameplayEffectHandle();
    }
...
```

For an ordinary Instant effect, a temporary Spec is created and released after execution:

```cpp
if (!OurCopyOfSpec)
{
    StackSpec = MakeUnique<FGameplayEffectSpec>(Spec);
    OurCopyOfSpec = StackSpec.Get();

    UAbilitySystemGlobals::Get().GlobalPreGameplayEffectSpecApply(*OurCopyOfSpec, this);
    OurCopyOfSpec->CaptureAttributeDataFromTarget(this);
}
```

Supply an additional GameplayCue notification for a stacked GE.

The purpose is to explicitly trigger a GameplayCue when handling stacking.

When a newly added GE arrives, PostReplicatedAdd triggers a GameplayCue. Stacking instead calls PostReplicatedChange, which mainly handles **duration refresh**, **stack count**, attribute aggregation updates, and related changes.

That path does not trigger the GameplayCue again, so an explicit invocation is needed.

| Function | Main responsibility | Performs attribute calculations? |
| --- | --- | --- |
| `InvokeGameplayCueExecuted_FromSpec` | Extract Cue information from the Spec and trigger an `Executed` event, such as hit visuals or sound | No |
| `ExecuteGameplayEffect` | Execute Modifiers, ExecutionCalculations, and other calculation logic; conditionally trigger Cues | Yes |

Decide whether to execute immediately according to the GE type:

```cpp
// Execute if this is an instant application effect
if (bTreatAsInfiniteDuration)
{
    // This is an instant application but we are treating it as an infinite duration for prediction. We should still predict the execute GameplayCUE.
    // (in non predictive case, this will happen inside ::ExecuteGameplayEffect)

    if (!bSuppressGameplayCues)
    {
        UAbilitySystemGlobals::Get().GetGameplayCueManager()->InvokeGameplayCueExecuted_FromSpec(this, *OurCopyOfSpec, PredictionKey);
    }
}
else if (Spec.Def->DurationPolicy == EGameplayEffectDurationType::Instant)
{
    // This is a non-predicted instant effect (it never gets added to ActiveGameplayEffects)
    ExecuteGameplayEffect(*OurCopyOfSpec, PredictionKey);
}
```

An ordinary Instant executes once directly.

For a client-predicted Instant, this branch supplies the GameplayCue through InvokeGameplayCueExecuted_FromSpec.

Duration effects skip this branch because they have already been handled earlier:

```cpp
AppliedEffect = ActiveGameplayEffects.ApplyGameplayEffectSpec(Spec, PredictionKey, bFoundExistingStackableGE);
```

Notify the GE components and both ASCs:

```cpp
// Notify the Gameplay Effect (and its Components) that it has been successfully applied
Spec.Def->OnApplied(ActiveGameplayEffects, *OurCopyOfSpec, PredictionKey);

UAbilitySystemComponent* InstigatorASC = Spec.GetContext().GetInstigatorAbilitySystemComponent();

// Send ourselves a callback	
OnGameplayEffectAppliedToSelf(InstigatorASC, *OurCopyOfSpec, MyHandle);

// Send the instigator a callback
if (InstigatorASC)
{
	InstigatorASC->OnGameplayEffectAppliedToTarget(this, *OurCopyOfSpec, MyHandle);
}
```

## The ExecuteGameplayEffect Path for an Ordinary Instant

```
ExecuteGameplayEffect
→ FActiveGameplayEffectsContainer::ExecuteActiveEffectsFrom
→ Calculate Modifiers / execute ExecutionCalculation outputs
→ InternalExecuteMod
  → Find the target AttributeSet
  → PreGameplayEffectExecute
  → ApplyModToAttribute
    → Calculate the new Base from the current Base
    → SetAttributeBaseValue
    → Aggregate and write Current
    → Attribute change delegates
  → PostGameplayEffectExecute
```

ExecutionCalculation can be customized to implement a GE's calculation logic. Configure it on the GE.

## Snapshot

The timing of Spec creation affects the captured data. Snapshot behavior is controlled by bSnapshot = true.

| Capture source | Snapshot timing with `bSnapshot = true` |
| --- | --- |
| Source (instigator) | **When the `GameplayEffectSpec` is created** |
| Target | **When the Spec is applied to the target** |

Consider a fireball:

1. Its damage Spec is created when launched, while Attack Power is **100**. The Source snapshot records that value.
2. While the fireball is in flight, the attacker's Attack Power increases to **200**.
3. When the Spec is applied on impact, damage is still calculated using the **100** captured at launch. If the target's Defense is also configured for snapshot capture, it is captured **when the Spec is applied on impact**.

To use this in practice, place the capture definitions in the `.cpp` file of a custom damage execution calculation class (`UGameplayEffectExecutionCalculation`), typically in the constructor of a dedicated capture-definition struct:

```cpp
// MyDamageExecution.cpp

namespace
{
    struct FDamageCaptureStatics
    {
        // 声明捕获所需的成员
        DECLARE_ATTRIBUTE_CAPTUREDEF(AttackPower);
        DECLARE_ATTRIBUTE_CAPTUREDEF(Defense);

        FDamageCaptureStatics()
        {
            // 初始化捕获定义：属性集、属性、来源、是否快照
            
            /**
            Source + true：创建 Spec 时捕获。你把 MakeOutgoingGameplayEffectSpec() 放在释放技能、发射子弹或命中时，就决定了具体时机。
            Target + true：应用 Spec 到目标时捕获，由 ApplyGameplayEffectSpecToTarget() 等调用的位置决定。
            */
            DEFINE_ATTRIBUTE_CAPTUREDEF(UMyAttributeSet, AttackPower, Source, true);

            DEFINE_ATTRIBUTE_CAPTUREDEF(UMyAttributeSet, Defense, Target, false);
        }
    };

    const FDamageCaptureStatics& DamageStatics()
    {
        static FDamageCaptureStatics Statics;
        return Statics;
    }
}
```

Then **register the attributes to capture in the ExecutionCalculation constructor**:

```cpp
UMyDamageExecution::UMyDamageExecution()
{
    RelevantAttributesToCapture.Add(
        DamageStatics().AttackPowerDef);

    RelevantAttributesToCapture.Add(
        DamageStatics().DefenseDef);
}
```

Finally, read the captured results in `Execute_Implementation()` and use them in the damage calculation.

## EffectContext Carries Source Information; It Does Not Validate Hits

`FGameplayEffectContextHandle` carries contextual information such as Instigator, EffectCauser, SourceObject, and HitResult.

## Spec Initialization

```cpp
void FGameplayEffectSpec::Initialize(const UGameplayEffect* InDef, const FGameplayEffectContextHandle& InEffectContext, float InLevel)
{
	Def = InDef;
	check(Def);	

	// SetContext requires the level to be set before it runs
	// however, there are code paths in SetLevel that can potentially (depends on game data setup) require the context to be set
	Level = InLevel;
	SetContext(InEffectContext);
	SetLevel(InLevel);

	// Init our ModifierSpecs
	Modifiers.SetNum(Def->Modifiers.Num());

	// Prep the spec with all of the attribute captures it will need to perform
	SetupAttributeCaptureDefinitions();
	
	// Add the GameplayEffect asset tags to the source Spec tags
	CapturedSourceTags.GetSpecTags().AppendTags(Def->GetAssetTags());

	// Prepare source tags before accessing them in the Components
	CaptureDataFromSource();
}
```

- Def: the static GE definition, such as GE_Burn's duration, period, and attribute modifications.
- EffectContext: the context discussed in the previous section.
- Level: the level used to calculate this application of the effect.
