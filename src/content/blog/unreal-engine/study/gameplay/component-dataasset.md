---
title: "Unreal Engine 组件化与数据驱动"
description: ""
publishedAt: 2026-10-08
tags:
  - Unreal Engine
  - 源码解读
  - Gameplay
  - Component
  - DataAsset
draft: false
---

## 什么是组件化

组件化是把具有明确状态、行为和生命周期的一项能力交给可挂在宿主 Actor 上的组件。

以门为例，若需求是“普通门、上锁门、计时门、可破坏门、需要钥匙的计时可破坏门”，靠子类逐项排列，很容易导致子类爆炸。因此可引入组件化思想：

- `ADoor` 表示世界中的门及其网格/动画
- `ULockComponent` 管理锁的判定与状态
- `UHealthComponent` 管理受伤与死亡

## 源码角度查看组件工作原理

### 1. 默认组件与运行时组件

UObject::CreateDefaultSubobject 是构造函数内声明默认子对象的入口。

```cpp
Lock = CreateDefaultSubobject<ULockComponent>(TEXT("Lock"));
```

运行时动态添加与之不同：NewObject 先创建 UObject，之后还要考虑 Actor 的实例组件记录、注册、移除及网络。一个常见流程是：

```cpp
// Owner 是已经存在于 World 的 Actor。
ULockComponent* Lock = NewObject<ULockComponent>(Owner);
Owner->AddInstanceComponent(Lock);
Lock->RegisterComponent();
// 不再需要时由拥有者调用 Lock->DestroyComponent()，并清理外部订阅。
```

`AActor::AddInstanceComponent` 设置 `CreationMethod::Instance` 并添加进 `InstanceComponents`；注册阶段会先检查Owner所在的 `UWorld` 是否有效，再调用 `RegisterComponentWithWorld`；`RegisterComponentWithWorld` 检查对象有效、是否已经注册和 World 是否存在。

### 2. BeginPlay 的实际门槛

AActor::BeginPlay 遍历组件，只对 IsRegistered() 且尚未 HasBegunPlay() 的组件调用 BeginPlay，可见：

```cpp
for (UActorComponent* Component : Components)
{
    // bHasBegunPlay will be true for the component if the component was renamed and moved to a new outer during initialization
    if (Component->IsRegistered() && !Component->HasBegunPlay())
    {
        Component->RegisterAllComponentTickFunctions(true);
        Component->BeginPlay();
        ensureMsgf(Component->HasBegunPlay(), TEXT("Failed to route BeginPlay (%s)"), *Component->GetFullName());
    }
}
```

若 Actor 已开始 Play，后来注册的组件则走UActorComponent::RegisterComponentWithWorld-> AActor::HandleRegisterComponentWithWorld 的初始化与 BeginPlay 路径。

```cpp
void AActor::HandleRegisterComponentWithWorld(UActorComponent* Component)
{
	const bool bOwnerBeginPlayStarted = HasActorBegunPlay() || IsActorBeginningPlay();

	if (!Component->HasBeenInitialized() && Component->bWantsInitializeComponent && IsActorInitialized())
	{
		Component->InitializeComponent();

		// The component was finally initialized, it can now be replicated
		// Note that if this component does not ask to be initialized, it would have started to be replicated inside AddOwnedComponent.
		if (bOwnerBeginPlayStarted && Component->GetIsReplicated())
		{
			AddComponentForReplication(Component);
		}
	}

	if (bOwnerBeginPlayStarted)
	{
		Component->RegisterAllComponentTickFunctions(true);

		if (!Component->HasBegunPlay())
		{
			Component->BeginPlay();
			ensureMsgf(Component->HasBegunPlay(), TEXT("Failed to route BeginPlay (%s)"), *Component->GetFullName());
		}
	}
}
```

### 3. 生命周期

Actor 会维护它所持有的组件。在 Actor 的 BeginDestroy 方法中，它会调用 UnregisterAllComponents。在这个方法里面，它会逐个遍历 Actor 所持有的这个组件，并调用每个组件的 UnregisterComponent ，这个方法会解除注册事件/Tick；。

```cpp
void UActorComponent::UnregisterComponent()
{
	SCOPE_CYCLE_COUNTER(STAT_UnregisterComponent);
	FScopeCycleCounterUObject ComponentScope(this);

	// Do nothing if not registered
	if(!IsRegistered())
	{
		UE_LOG(LogActorComponent, Log, TEXT("UnregisterComponent: (%s) Not registered. Aborting."), *GetPathName());
		return;
	}

	// If registered, should have a world
	checkf(WorldPrivate != nullptr, TEXT("%s"), *GetFullName());

	RegisterAllComponentTickFunctions(false);
	ExecuteUnregisterEvents();

	WorldPrivate = nullptr;
}
```

DestroyComponent 是结束该组件的语义入口。外部如果订阅了它的委托，仍应按业务协议解绑；GC 和组件注销不会替 UI 决定下一个数据源。

## 数据驱动：DataAsset 与类默认值各管什么

UDataAsset 是存放某系统数据的资产，可由原生派生类在内容浏览器创建。需要 AssetManager 主资产 ID、资产包或明确加载/卸载管理时，才进一步考虑 UPrimaryDataAsset。

> 这里补充一下二者区别：
>
> - `UDataAsset` 用于存储配置数据；
> - `UPrimaryDataAsset` 在此基础上提供了接入 `UAssetManager` 主资产管理体系的默认实现。
>
> **1. 主资产 ID（Primary Asset ID）**
>
> `UPrimaryDataAsset` 默认提供 `FPrimaryAssetId`，由资产类型（Type）和名称（Name）组成。
>
> 例如 `Equipment:DA_Sword`，AssetManager 可以通过该 ID 查找和加载已注册的资产，而不需要调用方直接持有资产引用或路径。
>
> 
>
> **2. 资产包（Asset Bundle）**
>
> Asset Bundle 用于将主资产引用的资源按用途分组，实现按需加载。
>
> ```cpp
> UPROPERTY(EditDefaultsOnly, meta=(AssetBundles="UI"))
> TSoftObjectPtr<UTexture2D> Icon;
> 
> UPROPERTY(EditDefaultsOnly, meta=(AssetBundles="Game"))
> TSoftObjectPtr<USkeletalMesh> WeaponMesh;
> ```
>
> 例如打开背包时只加载 `UI` 组的图标，实际装备时再加载 `Game` 组的模型，减少不必要的资源加载。
>
> 
>
> **3. 加载与卸载管理**
>
> AssetManager 提供统一的资源生命周期管理接口：
>
> - `LoadPrimaryAsset()`：加载主资产及指定 Bundle。
> - `ChangeBundleStateForPrimaryAssets()`：调整已加载的资源组。
> - `UnloadPrimaryAsset()`：释放 AssetManager 对主资产的加载保持。
>
> 注意：卸载不代表立即销毁资源。如果仍存在硬引用，资源可能继续驻留内存。
>
> 
>
> **总结**
>
> - `UDataAsset`：适合移动参数、攻击配置等普通静态数据。
> - `UPrimaryDataAsset`：适合装备、物品、角色配置等需要按 ID 查找、分组加载或统一管理生命周期的资产。

类默认对象（CDO）是另一种配置来源。UClass::GetDefaultObject 返回类默认对象；蓝图子类可覆盖默认属性。

对于“每种门一个稳定的类及默认网格/组件结构”，蓝图子类默认值已经合适。对于“同一种门逻辑有许多可复用配置，并希望配置作为独立资产引用、审查或替换”，DataAsset 更合适。

```cpp
UCLASS(BlueprintType)
class UDoorDefinition : public UDataAsset
{
    GENERATED_BODY()
public:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly)
    float InteractionRange = 200.f;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly)
    bool bStartsLocked = false;
};

// ADoor 内：配置引用和每个门自己的运行状态分开。
UPROPERTY(EditDefaultsOnly, Category="Door")
TObjectPtr<UDoorDefinition> Definition;

UPROPERTY(VisibleInstanceOnly, Category="Door")
bool bIsOpen = false;
```

### 何时不适合组件化？

判断组件是否合适，可问四个问题：

1. 组件对外能否用 2～5 个稳定操作解释？还是外部必须反复读写它的内部字段？
2. 它能否独立维护一个不变量，如血量范围、背包容量、锁状态？
3. 换一个宿主仍能成立吗？若到处 `Cast<ADoor>(GetOwner())`，很可能只是把门代码搬到了组件里。

### 职责分明的示例

![角色通过组件组合能力，组件调用技能系统并读取独立配置资产的职责划分图](data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221280%22%20height%3D%22940%22%20viewBox%3D%220%200%201280%20940%22%20fill%3D%22none%22%20role%3D%22img%22%20aria-labelledby%3D%22title%20desc%22%3E%0A%20%20%3Ctitle%20id%3D%22title%22%3EUnreal%20Engine%EF%BC%9A%E7%BB%84%E4%BB%B6%E5%8C%96%E4%B8%8E%E6%95%B0%E6%8D%AE%E9%A9%B1%E5%8A%A8%E7%9A%84%E8%81%8C%E8%B4%A3%E5%88%92%E5%88%86%3C%2Ftitle%3E%0A%20%20%3Cdesc%20id%3D%22desc%22%3E%E7%8E%A9%E5%AE%B6%E8%A7%92%E8%89%B2%E6%8B%A5%E6%9C%89%E6%94%BB%E5%87%BB%E3%80%81%E8%BF%9E%E6%8B%9B%E3%80%81%E5%8F%97%E5%87%BB%E5%92%8C%E9%97%AA%E9%81%BF%E7%BB%84%E4%BB%B6%EF%BC%8C%E6%95%8C%E4%BA%BA%E8%A7%92%E8%89%B2%E6%8B%A5%E6%9C%89%E6%94%BB%E5%87%BB%E5%92%8C%E5%8F%97%E5%87%BB%E7%BB%84%E4%BB%B6%E3%80%82%E8%BF%9E%E6%8B%9B%E7%BB%84%E4%BB%B6%E8%AF%B7%E6%B1%82%E6%94%BB%E5%87%BB%EF%BC%8C%E6%94%BB%E5%87%BB%E7%BB%84%E4%BB%B6%E6%BF%80%E6%B4%BB%E6%8A%80%E8%83%BD%E7%B3%BB%E7%BB%9F%EF%BC%8C%E6%8A%80%E8%83%BD%E7%B3%BB%E7%BB%9F%E5%90%91%E4%BA%8B%E4%BB%B6%E5%88%86%E5%8F%91%E5%8F%91%E9%80%81%E4%BA%8B%E4%BB%B6%EF%BC%8C%E4%BA%8B%E4%BB%B6%E5%88%86%E5%8F%91%E5%B0%86%E5%8F%97%E5%87%BB%E4%BA%8B%E4%BB%B6%E4%BC%A0%E9%80%92%E7%BB%99%E5%8F%97%E5%87%BB%E7%BB%84%E4%BB%B6%E3%80%82%E8%BF%9E%E6%8B%9B%E3%80%81%E6%94%BB%E5%87%BB%E5%92%8C%E5%8F%97%E5%87%BB%E7%BB%84%E4%BB%B6%E5%88%86%E5%88%AB%E8%AF%BB%E5%8F%96%E8%BF%9E%E6%8B%9B%E3%80%81%E6%94%BB%E5%87%BB%E5%92%8C%E8%A7%92%E8%89%B2%E9%85%8D%E7%BD%AE%E8%B5%84%E4%BA%A7%E3%80%82%E8%A7%92%E8%89%B2%E5%8D%A1%E7%89%87%E5%86%85%E7%9A%84%E6%A0%87%E7%AD%BE%E8%A1%A8%E7%A4%BA%E7%BB%84%E4%BB%B6%E5%BD%92%E5%B1%9E%EF%BC%9B%E5%AE%9E%E7%BA%BF%E8%A1%A8%E7%A4%BA%E8%B0%83%E7%94%A8%E6%88%96%E4%BA%8B%E4%BB%B6%EF%BC%8C%E8%99%9A%E7%BA%BF%E8%A1%A8%E7%A4%BA%E8%AF%BB%E5%8F%96%E9%85%8D%E7%BD%AE%E3%80%82%3C%2Fdesc%3E%0A%20%20%3Cdefs%3E%0A%20%20%20%20%3Cmarker%20id%3D%22arrow%22%20markerWidth%3D%228%22%20markerHeight%3D%228%22%20refX%3D%227%22%20refY%3D%224%22%20orient%3D%22auto%22%20markerUnits%3D%22userSpaceOnUse%22%3E%0A%20%20%20%20%20%20%3Cpath%20d%3D%22m1%201%206%203-6%203%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%221.8%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%0A%20%20%20%20%3C%2Fmarker%3E%0A%20%20%20%20%3Cmarker%20id%3D%22data-arrow%22%20markerWidth%3D%228%22%20markerHeight%3D%228%22%20refX%3D%227%22%20refY%3D%224%22%20orient%3D%22auto%22%20markerUnits%3D%22userSpaceOnUse%22%3E%0A%20%20%20%20%20%20%3Cpath%20d%3D%22m1%201%206%203-6%203%22%20stroke%3D%22%23b77924%22%20stroke-width%3D%221.8%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%0A%20%20%20%20%3C%2Fmarker%3E%0A%20%20%20%20%3Cstyle%3E%0A%20%20%20%20%20%20text%20%7B%20font-family%3A%20%22Segoe%20UI%22%2C%20%22Microsoft%20YaHei%22%2C%20%22PingFang%20SC%22%2C%20sans-serif%3B%20%7D%0A%20%20%20%20%20%20.heading%20%7B%20fill%3A%20%23172b45%3B%20font-size%3A%2019px%3B%20font-weight%3A%20700%3B%20%7D%0A%20%20%20%20%20%20.name%20%7B%20fill%3A%20%23172b45%3B%20font-size%3A%2022px%3B%20font-weight%3A%20700%3B%20%7D%0A%20%20%20%20%20%20.code%20%7B%20fill%3A%20%23516579%3B%20font-size%3A%2016px%3B%20%7D%0A%20%20%20%20%20%20.note%20%7B%20fill%3A%20%2364748b%3B%20font-size%3A%2016px%3B%20%7D%0A%20%20%20%20%20%20.chip%20%7B%20fill%3A%20%230f766e%3B%20font-size%3A%2016px%3B%20font-weight%3A%20600%3B%20%7D%0A%20%20%20%20%20%20.edge%20%7B%20stroke%3A%20%2364748b%3B%20stroke-width%3A%202%3B%20marker-end%3A%20url%28%23arrow%29%3B%20%7D%0A%20%20%20%20%20%20.read%20%7B%20stroke%3A%20%23b77924%3B%20stroke-width%3A%202%3B%20stroke-dasharray%3A%206%206%3B%20marker-end%3A%20url%28%23data-arrow%29%3B%20%7D%0A%20%20%20%20%20%20.label%20%7B%20fill%3A%20%23516579%3B%20font-size%3A%2014px%3B%20text-anchor%3A%20middle%3B%20%7D%0A%20%20%20%20%3C%2Fstyle%3E%0A%20%20%3C%2Fdefs%3E%0A%0A%20%20%3Crect%20width%3D%221280%22%20height%3D%22940%22%20fill%3D%22%23ffffff%22%2F%3E%0A%20%20%3Ctext%20x%3D%2240%22%20y%3D%2253%22%20fill%3D%22%23172b45%22%20font-size%3D%2229%22%20font-weight%3D%22700%22%3E%E7%BB%84%E4%BB%B6%E5%8C%96%E4%B8%8E%E6%95%B0%E6%8D%AE%E9%A9%B1%E5%8A%A8%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%2240%22%20y%3D%2284%22%20class%3D%22note%22%3E%E8%A7%92%E8%89%B2%E7%BB%84%E5%90%88%E8%83%BD%E5%8A%9B%EF%BC%8C%E7%BB%84%E4%BB%B6%E5%A4%84%E7%90%86%E8%A1%8C%E4%B8%BA%EF%BC%8C%E9%85%8D%E7%BD%AE%E8%B5%84%E4%BA%A7%E6%8F%90%E4%BE%9B%E6%95%B0%E6%8D%AE%E3%80%82%3C%2Ftext%3E%0A%20%20%3Cpath%20d%3D%22M40%20106H1240%22%20stroke%3D%22%23e2e8f0%22%2F%3E%0A%0A%20%20%3C%21--%20%E8%A7%92%E8%89%B2%E5%8D%A1%E7%89%87%E4%B8%AD%E7%9A%84%E6%A0%87%E7%AD%BE%E5%AF%B9%E5%BA%94%E4%B8%8B%E6%96%B9%E7%BB%84%E4%BB%B6%EF%BC%8C%E8%A1%A8%E7%A4%BA%E6%8B%A5%E6%9C%89%E5%85%B3%E7%B3%BB%E3%80%82%20--%3E%0A%20%20%3Ctext%20x%3D%2240%22%20y%3D%22141%22%20class%3D%22heading%22%3E01%20%E8%A7%92%E8%89%B2%E5%B1%82%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22175%22%20y%3D%22141%22%20class%3D%22note%22%3ECharacter%20%C2%B7%20%E6%A0%87%E7%AD%BE%E8%A1%A8%E7%A4%BA%E8%A7%92%E8%89%B2%E6%8B%A5%E6%9C%89%E7%9A%84%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%3Crect%20x%3D%2240%22%20y%3D%22162%22%20width%3D%22588%22%20height%3D%22136%22%20rx%3D%2214%22%20fill%3D%22%23f0f6ff%22%20stroke%3D%22%23c5d9f4%22%2F%3E%0A%20%20%3Crect%20x%3D%22652%22%20y%3D%22162%22%20width%3D%22588%22%20height%3D%22136%22%20rx%3D%2214%22%20fill%3D%22%23f0f6ff%22%20stroke%3D%22%23c5d9f4%22%2F%3E%0A%20%20%3Ctext%20x%3D%2264%22%20y%3D%22197%22%20class%3D%22name%22%3E%E7%8E%A9%E5%AE%B6%E8%A7%92%E8%89%B2%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22188%22%20y%3D%22197%22%20class%3D%22code%22%3ESwPlayerCharacter%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22676%22%20y%3D%22197%22%20class%3D%22name%22%3E%E6%95%8C%E4%BA%BA%E8%A7%92%E8%89%B2%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22800%22%20y%3D%22197%22%20class%3D%22code%22%3ESwEnemyCharacter%3C%2Ftext%3E%0A%20%20%3Cg%20fill%3D%22%23ffffff%22%20stroke%3D%22%23b8dcd7%22%3E%0A%20%20%20%20%3Crect%20x%3D%2264%22%20y%3D%22224%22%20width%3D%22116%22%20height%3D%2242%22%20rx%3D%228%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22196%22%20y%3D%22224%22%20width%3D%22116%22%20height%3D%2242%22%20rx%3D%228%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22328%22%20y%3D%22224%22%20width%3D%22116%22%20height%3D%2242%22%20rx%3D%228%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22460%22%20y%3D%22224%22%20width%3D%22116%22%20height%3D%2242%22%20rx%3D%228%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22676%22%20y%3D%22224%22%20width%3D%22116%22%20height%3D%2242%22%20rx%3D%228%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22808%22%20y%3D%22224%22%20width%3D%22116%22%20height%3D%2242%22%20rx%3D%228%22%2F%3E%0A%20%20%3C%2Fg%3E%0A%20%20%3Cg%20class%3D%22chip%22%20text-anchor%3D%22middle%22%3E%0A%20%20%20%20%3Ctext%20x%3D%22122%22%20y%3D%22251%22%3E%E6%94%BB%E5%87%BB%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22254%22%20y%3D%22251%22%3E%E8%BF%9E%E6%8B%9B%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22386%22%20y%3D%22251%22%3E%E5%8F%97%E5%87%BB%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22518%22%20y%3D%22251%22%3E%E9%97%AA%E9%81%BF%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22734%22%20y%3D%22251%22%3E%E6%94%BB%E5%87%BB%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22866%22%20y%3D%22251%22%3E%E5%8F%97%E5%87%BB%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%3C%2Fg%3E%0A%0A%20%20%3Ctext%20x%3D%2240%22%20y%3D%22343%22%20class%3D%22heading%22%3E02%20%E7%BB%84%E4%BB%B6%E5%B1%82%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22175%22%20y%3D%22343%22%20class%3D%22note%22%3EComponents%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22652%22%20y%3D%22343%22%20class%3D%22heading%22%3E03%20%E7%B3%BB%E7%BB%9F%E5%B1%82%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22787%22%20y%3D%22343%22%20class%3D%22note%22%3EGameplay%3C%2Ftext%3E%0A%20%20%3Crect%20x%3D%2240%22%20y%3D%22365%22%20width%3D%221200%22%20height%3D%22330%22%20rx%3D%2214%22%20fill%3D%22%23f8fafc%22%20stroke%3D%22%23e2e8f0%22%2F%3E%0A%0A%20%20%3C%21--%20%E4%B8%BB%E8%B0%83%E7%94%A8%E9%93%BE%E4%BB%8E%E5%B7%A6%E5%90%91%E5%8F%B3%EF%BC%9B%E5%8F%97%E5%87%BB%E4%BA%8B%E4%BB%B6%E5%90%91%E4%B8%8B%E5%88%86%E5%8F%91%E3%80%82%20--%3E%0A%20%20%3Cpath%20d%3D%22M308%20441H368%22%20class%3D%22edge%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M608%20441H668%22%20class%3D%22edge%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M908%20441H968%22%20class%3D%22edge%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M1088%20492V574%22%20class%3D%22edge%22%2F%3E%0A%20%20%3Ctext%20x%3D%22338%22%20y%3D%22413%22%20class%3D%22label%22%3E%E8%AF%B7%E6%B1%82%E6%94%BB%E5%87%BB%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22638%22%20y%3D%22413%22%20class%3D%22label%22%3E%E6%BF%80%E6%B4%BB%E6%8A%80%E8%83%BD%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22938%22%20y%3D%22413%22%20class%3D%22label%22%3E%E5%8F%91%E9%80%81%E4%BA%8B%E4%BB%B6%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%221138%22%20y%3D%22541%22%20class%3D%22label%22%3E%E5%8F%97%E5%87%BB%E4%BA%8B%E4%BB%B6%3C%2Ftext%3E%0A%0A%20%20%3Cg%20fill%3D%22%23effaf7%22%20stroke%3D%22%2393cfc3%22%20stroke-width%3D%221.5%22%3E%0A%20%20%20%20%3Crect%20x%3D%2268%22%20y%3D%22390%22%20width%3D%22240%22%20height%3D%22102%22%20rx%3D%2212%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22368%22%20y%3D%22390%22%20width%3D%22240%22%20height%3D%22102%22%20rx%3D%2212%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22968%22%20y%3D%22574%22%20width%3D%22240%22%20height%3D%2294%22%20rx%3D%2212%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22668%22%20y%3D%22574%22%20width%3D%22240%22%20height%3D%2294%22%20rx%3D%2212%22%2F%3E%0A%20%20%3C%2Fg%3E%0A%20%20%3Cg%20fill%3D%22%23f5f0fc%22%20stroke%3D%22%23c9b4e6%22%20stroke-width%3D%221.5%22%3E%0A%20%20%20%20%3Crect%20x%3D%22668%22%20y%3D%22390%22%20width%3D%22240%22%20height%3D%22102%22%20rx%3D%2212%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22968%22%20y%3D%22390%22%20width%3D%22240%22%20height%3D%22102%22%20rx%3D%2212%22%2F%3E%0A%20%20%3C%2Fg%3E%0A%20%20%3Cg%20text-anchor%3D%22middle%22%3E%0A%20%20%20%20%3Ctext%20x%3D%22188%22%20y%3D%22432%22%20class%3D%22name%22%3E%E8%BF%9E%E6%8B%9B%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22188%22%20y%3D%22462%22%20class%3D%22code%22%3EComboComponent%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22488%22%20y%3D%22432%22%20class%3D%22name%22%3E%E6%94%BB%E5%87%BB%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22488%22%20y%3D%22462%22%20class%3D%22code%22%3EAttackComponent%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22788%22%20y%3D%22432%22%20class%3D%22name%22%3E%E6%8A%80%E8%83%BD%E7%B3%BB%E7%BB%9F%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22788%22%20y%3D%22462%22%20class%3D%22code%22%3EAbilitySystemComponent%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%221088%22%20y%3D%22432%22%20class%3D%22name%22%3E%E4%BA%8B%E4%BB%B6%E5%88%86%E5%8F%91%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%221088%22%20y%3D%22462%22%20class%3D%22code%22%3EGameplay%20Events%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%221088%22%20y%3D%22612%22%20class%3D%22name%22%3E%E5%8F%97%E5%87%BB%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%221088%22%20y%3D%22641%22%20class%3D%22code%22%3EHitReactComponent%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22788%22%20y%3D%22612%22%20class%3D%22name%22%3E%E9%97%AA%E9%81%BF%E7%BB%84%E4%BB%B6%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22788%22%20y%3D%22641%22%20class%3D%22code%22%3EDodgeComponent%3C%2Ftext%3E%0A%20%20%3C%2Fg%3E%0A%20%20%3Ctext%20x%3D%22788%22%20y%3D%22553%22%20class%3D%22note%22%20text-anchor%3D%22middle%22%3E%E5%85%B6%E4%BB%96%E7%8B%AC%E7%AB%8B%E8%83%BD%E5%8A%9B%3C%2Ftext%3E%0A%0A%20%20%3C%21--%20%E9%85%8D%E7%BD%AE%E8%AF%BB%E5%8F%96%E4%B8%8E%E8%B0%83%E7%94%A8%E9%93%BE%E5%88%86%E5%BC%80%E5%B8%83%E7%BA%BF%EF%BC%8C%E7%AE%AD%E5%A4%B4%E6%8C%87%E5%90%91%E8%A2%AB%E8%AF%BB%E5%8F%96%E7%9A%84%E8%B5%84%E4%BA%A7%E3%80%82%20--%3E%0A%20%20%3Cpath%20d%3D%22M188%20492V790%22%20class%3D%22read%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M488%20492V790%22%20class%3D%22read%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M1088%20668V790%22%20class%3D%22read%22%2F%3E%0A%20%20%3Cg%20fill%3D%22%23f8fafc%22%3E%0A%20%20%20%20%3Crect%20x%3D%22160%22%20y%3D%22583%22%20width%3D%2256%22%20height%3D%2230%22%20rx%3D%226%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22460%22%20y%3D%22583%22%20width%3D%2256%22%20height%3D%2230%22%20rx%3D%226%22%2F%3E%0A%20%20%3C%2Fg%3E%0A%20%20%3Cg%20fill%3D%22%2392611d%22%20font-size%3D%2216%22%20text-anchor%3D%22middle%22%3E%0A%20%20%20%20%3Ctext%20x%3D%22188%22%20y%3D%22604%22%3E%E8%AF%BB%E5%8F%96%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22488%22%20y%3D%22604%22%3E%E8%AF%BB%E5%8F%96%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%221119%22%20y%3D%22759%22%3E%E8%AF%BB%E5%8F%96%3C%2Ftext%3E%0A%20%20%3C%2Fg%3E%0A%0A%20%20%3Ctext%20x%3D%22668%22%20y%3D%22739%22%20class%3D%22heading%22%3E04%20%E9%85%8D%E7%BD%AE%E5%B1%82%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%22668%22%20y%3D%22765%22%20class%3D%22note%22%3EData%20Assets%3C%2Ftext%3E%0A%20%20%3Cg%20fill%3D%22%23fffaed%22%20stroke%3D%22%23e6ca91%22%20stroke-width%3D%221.5%22%3E%0A%20%20%20%20%3Crect%20x%3D%2268%22%20y%3D%22790%22%20width%3D%22240%22%20height%3D%2292%22%20rx%3D%2212%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22368%22%20y%3D%22790%22%20width%3D%22240%22%20height%3D%2292%22%20rx%3D%2212%22%2F%3E%0A%20%20%20%20%3Crect%20x%3D%22968%22%20y%3D%22790%22%20width%3D%22240%22%20height%3D%2292%22%20rx%3D%2212%22%2F%3E%0A%20%20%3C%2Fg%3E%0A%20%20%3Cg%20text-anchor%3D%22middle%22%3E%0A%20%20%20%20%3Ctext%20x%3D%22188%22%20y%3D%22829%22%20class%3D%22name%22%3E%E8%BF%9E%E6%8B%9B%E9%85%8D%E7%BD%AE%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22188%22%20y%3D%22858%22%20class%3D%22code%22%3EComboDataAsset%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22488%22%20y%3D%22829%22%20class%3D%22name%22%3E%E6%94%BB%E5%87%BB%E9%85%8D%E7%BD%AE%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%22488%22%20y%3D%22858%22%20class%3D%22code%22%3EAttackDataAsset%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%221088%22%20y%3D%22829%22%20class%3D%22name%22%3E%E8%A7%92%E8%89%B2%E9%85%8D%E7%BD%AE%3C%2Ftext%3E%0A%20%20%20%20%3Ctext%20x%3D%221088%22%20y%3D%22858%22%20class%3D%22code%22%3ECharacterDataAsset%3C%2Ftext%3E%0A%20%20%3C%2Fg%3E%0A%20%20%3Cpath%20d%3D%22M668%20809H713%22%20class%3D%22edge%22%2F%3E%0A%20%20%3Ctext%20x%3D%22728%22%20y%3D%22815%22%20class%3D%22note%22%3E%E8%B0%83%E7%94%A8%20%2F%20%E4%BA%8B%E4%BB%B6%3C%2Ftext%3E%0A%20%20%3Cpath%20d%3D%22M668%20852H713%22%20class%3D%22read%22%2F%3E%0A%20%20%3Ctext%20x%3D%22728%22%20y%3D%22858%22%20class%3D%22note%22%3E%E8%AF%BB%E5%8F%96%E9%85%8D%E7%BD%AE%3C%2Ftext%3E%0A%20%20%3Ctext%20x%3D%2240%22%20y%3D%22917%22%20fill%3D%22%237b8796%22%20font-size%3D%2214%22%3E%E8%81%8C%E8%B4%A3%E5%88%92%E5%88%86%E7%A4%BA%E4%BE%8B%20%C2%B7%20%E7%BB%BF%E8%89%B2%E8%A1%A8%E7%A4%BA%E7%BB%84%E4%BB%B6%EF%BC%8C%E7%B4%AB%E8%89%B2%E8%A1%A8%E7%A4%BA%E7%B3%BB%E7%BB%9F%E8%83%BD%E5%8A%9B%EF%BC%9B%E5%9B%BE%E4%B8%AD%E4%BB%85%E5%B1%95%E7%A4%BA%E4%B8%BB%E8%A6%81%E5%8D%8F%E4%BD%9C%E5%85%B3%E7%B3%BB%E3%80%82%3C%2Ftext%3E%0A%3C%2Fsvg%3E%0A)
