---
title: "GameplayEffect—定义、应用参数、上下文与属性捕获"
description: ""
publishedAt: 2026-10-14
tags: ["Unreal Engine","Ability System","source-reading"]
draft: false
---

## GE 类描述规则，Spec 装入本次参数

通过 MakeOutgoingSpec 组装 Spec：

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

- GE CDO 是共用定义。
- 等级、上下文、SetByCaller、捕获数据等运行差异写入 Spec。

注意 FGameplayEffectSpecHandle 的 Data 是由 TSharedPtr 管理，因此复制一份 Handle，会使用同一份 Data，使用时需要明确每个目标是否需要独立的 Spec。

```cpp
FGameplayEffectSpecHandle::FGameplayEffectSpecHandle(FGameplayEffectSpec* DataPtr) : Data(DataPtr)
    
TSharedPtr<FGameplayEffectSpec>	Data;
```

## 三种 DurationPolicy

| 配置                           | 典型用途                 | 属性行为                                  | 移除的含义                               |
| ------------------------------ | ------------------------ | ----------------------------------------- | ---------------------------------------- |
| Instant                        | 一次伤害、治疗、标准消耗 | 执行 Modifier/Execution，改变 Base        | 通常不留下可移除活动记录，不能移除来退款 |
| HasDuration，Period=0          | 3 秒冷却、5 秒加速       | 活动修饰参与 Current 聚合；也可只授予标签 | 到期移除修饰与标签贡献                   |
| Infinite，Period=0             | 装备被动、持续光环       | 与持续效果类似，无自动到期                | 由卸装、驱散等规则显式移除               |
| HasDuration/Infinite，Period>0 | 灼烧、定时恢复           | 每个周期执行，修改 Base                   | 移除后停止后续执行，不恢复已扣血量       |

先区分两个概念：**非周期性 GE（Period = 0）、周期性 GE（Period > 0）**。

假设一个 Buff 持续 5 秒，攻击力 +50，这种属于非周期性 GE：

```cpp
DurationPolicy = HasDuration;
Period = 0;
```

GAS 会将这个 Modifier 加入属性聚合器（Aggregator），参与 CurrentValue 的计算。

- 原始 BaseValue = 100
- Buff 生效：CurrentValue = 150
- Buff 移除：CurrentValue = 100

假设一个持续 5 秒，每秒减少 10 点生命值的灼烧效果，这种属于非周期性 GE：

```cpp
DurationPolicy = HasDuration;
Period = 1.0f;
```

GAS 不会把这个伤害 Modifier 当作持续修饰加入属性聚合器，而是在每次周期触发时执行它。

- 第 1 次执行：BaseValue = 90
- 第 2 次执行：BaseValue = 80
- 第 3 次执行：BaseValue = 70

即使灼烧效果被移除，BaseValue 也不会恢复到 100。

> **为什么要区分 BaseValue 和 CurrentValue？**
>
> 
>
> 假设角色的攻击力为 100。
>
> 1. 获得 Buff A：攻击力 +50%，变成 150。
> 2. 获得 Buff B：攻击力 +20%，变成 170（假设都是基于基础值计算）。
> 3. Buff A 到期，需要移除它的 +50% 加成。
>
> 此时应该剩下多少攻击力？正确答案是 120。
>
> 如果系统只保存一个攻击力数值 170，要正确撤销 Buff A，会非常复杂。
>
> 
>
> GAS 将属性分成两个层次：
>
> - `BaseValue`：基础数值，记录属性本身的变化。
> - `CurrentValue`：经过当前所有有效 Modifier 聚合计算后的最终结果。
>
> | 操作                  | BaseValue | CurrentValue |
> | --------------------- | --------- | ------------ |
> | 初始攻击力            | 100       | 100          |
> | 获得 Buff A（+50%）   | 100       | 150          |
> | 获得 Buff B（+20%）   | 100       | 170          |
> | 基础攻击力永久增加 20 | 120       | 204          |
> | Buff A 到期           | 120       | 144          |
> | Buff B 到期           | 120       | 120          |
>
> 这样就很好的解决的最终结果的问题。

## 应用 Effect 与失败分支

ApplyGameplayEffectSpecToTarget 最终调用 目标 ASC 的 ApplyGameplayEffectSpecToSelf:

```cpp
FActiveGameplayEffectHandle UAbilitySystemComponent::ApplyGameplayEffectSpecToSelf(const FGameplayEffectSpec &Spec, FPredictionKey PredictionKey)
```

在这个方法中，开头会先上锁，防止应用 GE 期间，回调再次增删 GE，导致存放 GE TArray 扩容，导致原有的指针失效：

```cpp
FScopedActiveGameplayEffectLock ScopeLock(ActiveGameplayEffects);
```

例如：

1. 正在应用 GE_A，拿到了 `AppliedEffect`。
2. GE_A 的回调又给自己添加 GE_B。
3. 如果内部 `TArray` 因此扩容，GE_A 的地址就可能变化。
4. 外层函数继续通过原来的 `AppliedEffect`、`OurCopyOfSpec` 访问，就会出问题。

然后进行鉴权：是否持有网络权威、是否允许客户端预测。

```cpp
// Check Network Authority
if (!HasNetworkAuthorityToApplyGameplayEffect(PredictionKey))
{
    return FActiveGameplayEffectHandle();
}
```

> 为什么客户端允许预测？
> 
>
>
> 例如玩家按技能后立即扣蓝，如果一定等服务器回包，反馈就有延迟。GAS 允许客户端先预测应用，再借助预测键和服务器结果进行协调。

接着会 **排除周期型 GE 的预测**：

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

因为当前只支持一次应用，无法预测后续周期变化。

接着会逐个检查 ApplicationQuery、GE Components 的 CanApply，看该 GE 是否被拦截。

接着会把预测的 Instant 临时当成 Infinite：

```cpp
// Clients should treat predicted instant effects as if they have infinite duration. The effects will be cleaned up later.
bool bTreatAsInfiniteDuration = GetOwnerRole() != ROLE_Authority && PredictionKey.IsLocalClientKey() && Spec.Def->DurationPolicy == EGameplayEffectDurationType::Instant;
```

由于存在客户端预测，因此将 Instant 视作 Infinite 可在预测失败的情况下**方便回退**。

接着进入 OurCopyOfSpec 存放位置，持续型、无限型，以及刚才的预测 Instant，需要一个活动 GE 实例，但如果找到可叠层(bFoundExistingStackableGE)的 GE，则直接更新已有的实例：

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

如果是普通的 Instant，则会创建一个临时的Spec，执行完毕后释放：

```cpp
if (!OurCopyOfSpec)
{
    StackSpec = MakeUnique<FGameplayEffectSpec>(Spec);
    OurCopyOfSpec = StackSpec.Get();

    UAbilitySystemGlobals::Get().GlobalPreGameplayEffectSpecApply(*OurCopyOfSpec, this);
    OurCopyOfSpec->CaptureAttributeDataFromTarget(this);
}
```

对叠层 GE 补充 GameplayCue 通知 

这里主要目的是在处理堆叠情况下，主动激活一次GameplayCue。

当收到新增的GE时，会走 PostReplicatedAdd，此时会激活一次GameplayCue， 但在堆叠时，实际调用的是 PostReplicatedChange，它主要负责的是**持续时间的刷新**、**堆叠层数** 、属性聚合的更新等等。

这时并不会再次激活GameplayCue，因此主动激活一次GameplayCue。

| 函数                                 | 主要职责                                                          | 会不会执行属性结算 |
| ------------------------------------ | ----------------------------------------------------------------- | ------------------ |
| `InvokeGameplayCueExecuted_FromSpec` | 从 Spec 提取 Cue 信息，触发 `Executed` 事件，例如命中特效、音效   | 不会               |
| `ExecuteGameplayEffect`              | 执行 Modifiers、ExecutionCalculation 等结算逻辑，并按条件触发 Cue | 会                 |

根据 GE 类型决定是否立即执行

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

对于普通的 Instant，直接执行一次；

对于客户端预测的 Instant，这里补发 GameplayCue （InvokeGameplayCueExecuted_FromSpec）；

对于Duration，则直接跳过，因为已经在前面执行了:

```cpp
AppliedEffect = ActiveGameplayEffects.ApplyGameplayEffectSpec(Spec, PredictionKey, bFoundExistingStackableGE);
```

通知 GE 组件和双方 ASC

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

## 普通 Instant 的执行链路ExecuteGameplayEffect

```
ExecuteGameplayEffect
→ FActiveGameplayEffectsContainer::ExecuteActiveEffectsFrom
→ 计算 Modifier / 执行 ExecutionCalculation 输出
→ InternalExecuteMod
  → 找到目标 AttributeSet
  → PreGameplayEffectExecute
  → ApplyModToAttribute
    → 从 Base 计算新 Base
    → SetAttributeBaseValue
    → 聚合/写入 Current
    → 属性变化委托
  → PostGameplayEffectExecute
```

ExecutionCalculation 可自定义，主要负责执行 GE 中自定义的结算逻辑，需在GE中配置。

## Snapshot

Spec 创建时机不同，对应的数据都会不一样，由bSnapshot = true控制。

| 捕获对象         | `bSnapshot = true` 的快照时机    |
| ---------------- | -------------------------------- |
| Source（施加者） | **创建 `GameplayEffectSpec` 时** |
| Target（目标）   | **把 Spec 应用到目标时**         |

例如，一颗火球：

1. 发射时创建伤害 Spec，此时攻击力为 **100**，Source 快照记录这时的攻击力。
2. 飞行途中，攻击者攻击力提升到 **200**。
3. 命中时应用 Spec，仍按发射时捕获的 **100** 计算；如果目标防御也配置了快照，则捕获的是**命中应用时**的防御。

具体使用方法：

一般放在 自定义伤害执行计算类（`UGameplayEffectExecutionCalculation`）的 `.cpp` 文件里，一个专门管理捕获定义的结构体构造函数中。

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

然后在 **ExecutionCalculation 的构造函数中注册**需要捕获的属性：

```cpp
UMyDamageExecution::UMyDamageExecution()
{
    RelevantAttributesToCapture.Add(
        DamageStatics().AttackPowerDef);

    RelevantAttributesToCapture.Add(
        DamageStatics().DefenseDef);
}
```

最后在 `Execute_Implementation()` 中读取捕获结果，用于伤害计算。

## EffectContext 负责来源信息，不负责证明命中合法

`FGameplayEffectContextHandle` 携带 Instigator、EffectCauser、SourceObject、HitResult 等上下文。

## Spec 初始化

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

- Def：GE 的静态配置定义，例如 GE_Burn 配置持续时间、周期、属性修改等。
- EffectContext： 上一节已经提到。
- Level：这次效果按多少级计算

