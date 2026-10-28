---
title: "反射模型与核心类型"
description: "本文介绍了什么是反射，核心类的继承关系，以及历史上 UObject 与 UProperty 的问题"
publishedAt: 2026-10-21
tags: ["Unreal Engine","source-reading" , "Reflection", "UObject", "FField"]
draft: false
---

假设需要制作一个通用属性面板，需要同时支持角色武器技能等配置。

那么这个面板就需要知道这个对象它的类型是什么？有哪些可编辑的属性？应当在内存的什么位置读写。

反射系统的目的就是为这些问题提供一个统一的接口。 

## 类声明

```cpp
UCLASS(BlueprintType)
class UReflectionHero : public UObject
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Hero")
    float Health = 100.f;

    int32 InternalCounter = 0;

    UFUNCTION(BlueprintCallable, Category="Hero")
    void Heal(float Amount);
};
```

对于 C++ 的编译器来说，它能看到成员变量、函数，并且访问规则、内存布局等，都遵循 C++。 

对于反射系统来说， Health 和 Heal 需要额外生成描述，需要进行反射属性注册。

![img](data:image/svg+xml;charset=utf-8,%3Csvg%20font-family%3D%22-apple-system-body%2C%20ui-sans-serif%2C%20-apple-system%2C%20system-ui%2C%20%26quot%3BSegoe%20UI%26quot%3B%2C%20Helvetica%2C%20%26quot%3BApple%20Color%20Emoji%26quot%3B%2C%20Arial%2C%20sans-serif%2C%20%26quot%3BSegoe%20UI%20Emoji%26quot%3B%2C%20%26quot%3BSegoe%20UI%20Symbol%26quot%3B%22%20font-weight%3D%22400%22%20data-d-component%3D%22svg%22%20fill%3D%22currentColor%22%20style%3D%22color%3Argb(32%2C%2032%2C%2032)%22%20viewBox%3D%220%200%20340%20294%22%20width%3D%22100%25%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%229%22%20y%3D%228%22%20width%3D%22148%22%20height%3D%2281%22%20rx%3D%228%22%20fill%3D%22%23E7F0FF%22%20stroke%3D%22%23427BC1%22%2F%3E%3Ctext%20x%3D%2222%22%20y%3D%2229%22%20font-size%3D%2213%22%20font-weight%3D%22bold%22%20fill%3D%22%23194D91%22%3EHeroA%20%E5%AE%9E%E4%BE%8B%3C%2Ftext%3E%3Ctext%20x%3D%2222%22%20y%3D%2249%22%20font-size%3D%2212%22%20fill%3D%22%23194D91%22%3EHealth%20%3D%20100%3C%2Ftext%3E%3Ctext%20x%3D%2222%22%20y%3D%2269%22%20font-size%3D%2211%22%20fill%3D%22%2342658D%22%3EGetClass()%3C%2Ftext%3E%3Crect%20x%3D%22183%22%20y%3D%228%22%20width%3D%22148%22%20height%3D%2281%22%20rx%3D%228%22%20fill%3D%22%23E7F0FF%22%20stroke%3D%22%23427BC1%22%2F%3E%3Ctext%20x%3D%22196%22%20y%3D%2229%22%20font-size%3D%2213%22%20font-weight%3D%22bold%22%20fill%3D%22%23194D91%22%3EHeroB%20%E5%AE%9E%E4%BE%8B%3C%2Ftext%3E%3Ctext%20x%3D%22196%22%20y%3D%2249%22%20font-size%3D%2212%22%20fill%3D%22%23194D91%22%3EHealth%20%3D%2035%3C%2Ftext%3E%3Ctext%20x%3D%22196%22%20y%3D%2269%22%20font-size%3D%2211%22%20fill%3D%22%2342658D%22%3EGetClass()%3C%2Ftext%3E%3Cpath%20d%3D%22M83%2089%20V107%20H170%20V130%20M257%2089%20V107%20H170%22%20fill%3D%22none%22%20stroke%3D%22%23538AC8%22%20stroke-width%3D%221.8%22%2F%3E%3Cpath%20d%3D%22M165%20123%20L170%20131%20L175%20123%22%20fill%3D%22none%22%20stroke%3D%22%23538AC8%22%20stroke-width%3D%221.8%22%2F%3E%3Crect%20x%3D%2255%22%20y%3D%22134%22%20width%3D%22230%22%20height%3D%2291%22%20rx%3D%228%22%20fill%3D%22%23E6F3E9%22%20stroke%3D%22%2339945B%22%2F%3E%3Ctext%20x%3D%22170%22%20y%3D%22156%22%20font-size%3D%2214%22%20font-weight%3D%22bold%22%20fill%3D%22%23216C3B%22%20text-anchor%3D%22middle%22%3E%E5%90%8C%E4%B8%80%E4%B8%AA%20UClass%3C%2Ftext%3E%3Ctext%20x%3D%22170%22%20y%3D%22176%22%20font-size%3D%2212%22%20fill%3D%22%23216C3B%22%20text-anchor%3D%22middle%22%3EFFloatProperty%EF%BC%9AHealth%3C%2Ftext%3E%3Ctext%20x%3D%22170%22%20y%3D%22195%22%20font-size%3D%2212%22%20fill%3D%22%23216C3B%22%20text-anchor%3D%22middle%22%3EUFunction%EF%BC%9AHeal%3C%2Ftext%3E%3Ctext%20x%3D%22170%22%20y%3D%22212%22%20font-size%3D%2210%22%20fill%3D%22%2339784E%22%20text-anchor%3D%22middle%22%3E%E6%8F%8F%E8%BF%B0%E7%B1%BB%E7%BB%93%E6%9E%84%EF%BC%8C%E8%80%8C%E9%9D%9E%E5%AE%9E%E4%BE%8B%E5%B1%9E%E6%80%A7%E5%80%BC%3C%2Ftext%3E%3Cpath%20d%3D%22M170%20225%20V246%22%20stroke%3D%22%23999%22%20stroke-width%3D%221.5%22%20stroke-dasharray%3D%224%203%22%2F%3E%3Crect%20x%3D%2265%22%20y%3D%22249%22%20width%3D%22210%22%20height%3D%2237%22%20rx%3D%227%22%20fill%3D%22%23F5EDDC%22%20stroke%3D%22%23C29B4D%22%2F%3E%3Ctext%20x%3D%22170%22%20y%3D%22264%22%20font-size%3D%2212%22%20text-anchor%3D%22middle%22%20font-weight%3D%22bold%22%20fill%3D%22%23825E22%22%3ECDO%EF%BC%88%E7%B1%BB%E9%BB%98%E8%AE%A4%E5%AF%B9%E8%B1%A1%EF%BC%89%3C%2Ftext%3E%3Ctext%20x%3D%22170%22%20y%3D%22278%22%20font-size%3D%2211%22%20text-anchor%3D%22middle%22%20fill%3D%22%23825E22%22%3E%E9%BB%98%E8%AE%A4%20Health%20%3D%20100%3C%2Ftext%3E%3C%2Fsvg%3E)

简化关系图：CDO 由类持有；两个实例共享类描述，但不共享 Health 的存储空间。

### UClass、CDO、实例

```cpp
/** The class default object; used for delta serialization and object initialization */
TObjectPtr<UObject> UClass::ClassDefaultObject;
```

ClassDefaultObject 是 UClass 中的成员，指向该类的默认对象（CDO）。

- UClass：描述这个类是什么。
- CDO：这个类的一份默认对象。
- 普通实例：游戏里某个具体对象。

**一个实例的创建过程：**

1. 首先加载并注册反射信息，创建一个 UClass。
2. 引擎为该 UClass 创建一个类的默认对象 CDO，用来保存该类的默认值。
3. 创建实例，根据 CDO 初始化属性，然后进行实例自身的属性修改。 

实例是根据 UClass 创建的具体对象。对于 Actor，实例可以放置在关卡中，也可以在运行时动态生成。

再看一个示例

```cpp
void AStudyCharacter::BeginPlay()
{
    Super::BeginPlay();

    // 当前实例的名称
    UE_LOG(LogTemp, Warning, TEXT("Instance: %s"),
        *GetName());

    // 当前实例所属的运行时类
    UE_LOG(LogTemp, Warning, TEXT("Runtime Class: %s"),
        *GetClass()->GetName());

    // C++ 原生类对应的 UClass
    UE_LOG(LogTemp, Warning, TEXT("Native Class: %s"),
        *AStudyCharacter::StaticClass()->GetName());

    // 当前运行时类的 CDO
    UE_LOG(LogTemp, Warning, TEXT("CDO: %s"),
        *GetClass()->GetDefaultObject()->GetName());
}
```

输出结果：

```
Instance: BP_ThirdPersonCharacter_C_0
Runtime Class: BP_ThirdPersonCharacter_C
Native Class: StudyCharacter
CDO: Default__BP_ThirdPersonCharacter_C
```

## 核心类型关系

```cpp
UObject
└── UField
    ├── UStruct
    │   ├── UClass
    │   ├── UScriptStruct
    │   └── UFunction
    └── UEnum

FField                         ← 另一套继承体系
└── FProperty
    ├── FNumericProperty
    │   └── 数值属性具体类型
    ├── FBoolProperty
    ├── FObjectPropertyBase
    ├── FStructProperty
    ├── FArrayProperty
    └── ……
```

UObject：接入 UE 对象系统的基础对象。

UField：UObject 体系内反射字段的基础描述。

UStruct：组织属性并描述一段数据布局的技术描述。 

UClass：描述 UObject 类。

UScriptStruct：描述反射结构体。

UFunction：描述可通过反射调用的函数。

UEnum：描述枚举项与枚举值。

FProperty：描述一个属性及其操作方式。

### 为什么 UFunction 也继承 UStruct？

函数的一次调用有一块参数内存。例如：

```cpp
float GetFloatValue(float InTime);
```

可以用这样的布局描述输入和输出：

```cpp
struct Parameters
{
    float InTime;
    float ReturnValue;
};
```

函数同样需要“有哪些字段、字段类型是什么、偏移是多少”。这正是 UStruct 所能提供的。

### UStruct 里为什么同时有 Children 和 ChildProperties？

```cpp
UCLASS(BlueprintType)
class UReflectionHero : public UObject
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Hero")
    float Health = 100.f;

    int32 InternalCounter = 0;

    UFUNCTION(BlueprintCallable, Category="Hero")
    void Heal(float Amount);
};
```

前面已经看到，`UReflectionHero` 的 UClass 保存了 `Health` 的属性描述和 `Heal` 的函数描述。

接下来就有一个具体问题：**这些描述在 UClass 内部怎样组织起来，供引擎查找和遍历？**

UClass 从 UStruct 继承了两个链表入口：

```cpp
/** Pointer to start of linked list of child fields */
TObjectPtr<UField> Children;

/** Pointer to start of linked list of child fields */
FField* ChildProperties;
```

UReflectionHero 对应的 UClass:

- Children -> Heal 的 UFunction

- ChildProperties -> Health 的 FFloatProperty

Heal 对应的 UFunction(同样继承自 UStruct)

- ChildProperties -> Amount 的 FFloatProperty

> 早期 UE4 当中，UProperty 描述属性，继承自 UField，因而可以和函数描述一起挂在 Children 上，这会导致每一份属性都作为 UObject 进行管理，增加 GC 的开销。
>
> 现在将原来的 UProperty 分到另一条链上，这样需要管理的 UObject 数量会减少。 
>
> ```cpp
> UPROPERTY()
> float Health = 100.f;
> 
> UPROPERTY()
> UObject* Target = nullptr;
> ```
> 这里的 Health 就无需 UObject 管理逻辑，但这里的 Target 仍然需要。 

### USTRUCT 实例不是 UObject

这里需要区分一下，USTRUCT 并不是继承 UObject 的 UStruct。