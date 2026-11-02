---
title: "FProperty 与 内存访问"
description: "本文讲解了编辑器是如何找到某个对象成员的全过程，帮助理解反射系统的工作原理"
publishedAt: 2026-10-28
tags: ["Unreal Engine","源码解读", "Reflection", "Property"]
draft: false
---

本文仅作为个人在学习过程中的记录，如有错误，欢迎指出！

## 场景

假设项目里有这样一个类。

```cpp
UCLASS()
class UReflectionHero : public UObject
{
    GENERATED_BODY()

public:
    UPROPERTY()
    float Health = 100.f;
};
```

如果已经有了 `UReflectionHero*`，可以直接访问

```cpp
float Value = Hero->Health;
```

因为编译器已经知道 `Hero` 的类型，可以直接读取其成员变量。

但若是一个属性查看工具，既要查看组件，也要查看武器。对于 `UObject` 对象，它的声明里肯定不会存在 

```cpp
Object->Health：UObject
```

因此，需要借助 UE 的反射系统获取，大致过程是：

```
问 Object：你的实际类型是什么？       → GetClass()
问这个类型：有没有叫 Health 的属性？   → 查找 FProperty
拿属性描述（元数据）读取 Object 里的血量。       → 属性读写接口
```

> 元数据：描述数据的数据。

## 编辑器是如何知道这个 Object 的值的

```cpp
#include "UObject/Class.h"
#include "UObject/UnrealType.h"

static bool TryReadHealth(UObject* Object, float& OutHealth)
{
    if (!IsValid(Object))
    {
        return false;
    }

    // 第一步：拿到这个对象的实际类型描述。
    UClass* Class = Object->GetClass();

    // 第二步：在类型描述中，找名叫 Health 的 float 属性。
    FFloatProperty* HealthProperty = FindFProperty<FFloatProperty>(Class, FName(TEXT("Health")));

    if (!HealthProperty)
    {
        return false;
    }

    // 第三步：用这个描述，读取当前 Object 里的值。
    OutHealth = HealthProperty->GetPropertyValue_InContainer(Object);
    return true;
}
```

因此，假设 `HeroA`、`HeroB` 已经是有效对象，血量分别为 100 和 35：

```cpp
float Value = 0.f;

TryReadHealth(HeroA, Value); // 成功时，Value 变成 100。
TryReadHealth(HeroB, Value); // 成功时，Value 变成 35。
```

### FindFProperty

在 `Class` 所描述的类型中，查找名字为 `Health`、描述类型为 `FFloatProperty` 的属性。

### InContainer

"装着这个成员的那块内存"，接口只是需要知道：从谁身上读这个成员？

### 如何读 `Health`？

对象起始地址 + 偏移量

![img](data:image/svg+xml;charset=utf-8,%3Csvg%20font-family%3D%22-apple-system-body%2C%20ui-sans-serif%2C%20-apple-system%2C%20system-ui%2C%20%26quot%3BSegoe%20UI%26quot%3B%2C%20Helvetica%2C%20%26quot%3BApple%20Color%20Emoji%26quot%3B%2C%20Arial%2C%20sans-serif%2C%20%26quot%3BSegoe%20UI%20Emoji%26quot%3B%2C%20%26quot%3BSegoe%20UI%20Symbol%26quot%3B%22%20font-weight%3D%22400%22%20data-d-component%3D%22svg%22%20fill%3D%22currentColor%22%20style%3D%22color%3Argb(45%2C%2045%2C%2043)%22%20viewBox%3D%220%200%20340%20187%22%20width%3D%22100%25%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%228%22%20y%3D%228%22%20width%3D%22324%22%20height%3D%2253%22%20rx%3D%227%22%20fill%3D%22%2364748b%22%20fill-opacity%3D%22.12%22%20stroke%3D%22%2394a3b8%22%2F%3E%3Ctext%20x%3D%2220%22%20y%3D%2228%22%20font-size%3D%2212%22%20font-weight%3D%22600%22%20fill%3D%22currentColor%22%3EFFloatProperty%EF%BC%88%E5%B1%9E%E6%80%A7%E6%8F%8F%E8%BF%B0%EF%BC%89%3C%2Ftext%3E%3Ctext%20x%3D%2220%22%20y%3D%2246%22%20font-size%3D%2211%22%20fill%3D%22currentColor%22%3EHealth%20%C2%B7%20float%20%C2%B7%20%E5%81%8F%E7%A7%BB%E9%87%8F%20d%3C%2Ftext%3E%3Cpath%20d%3D%22M170%2061%20V76%20H86%20V91%20M170%2076%20H254%20V91%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%2F%3E%3Cpath%20d%3D%22M82%2086%20L86%2092%20L90%2086%20M250%2086%20L254%2092%20L258%2086%22%20stroke%3D%22%2364748b%22%20fill%3D%22none%22%20stroke-width%3D%221.5%22%2F%3E%3Crect%20x%3D%228%22%20y%3D%2295%22%20width%3D%22154%22%20height%3D%2280%22%20rx%3D%227%22%20fill%3D%22%2364748b%22%20fill-opacity%3D%22.07%22%20stroke%3D%22%2394a3b8%22%2F%3E%3Ctext%20x%3D%2220%22%20y%3D%22113%22%20font-size%3D%2212%22%20font-weight%3D%22600%22%20fill%3D%22currentColor%22%3EHeroA%3C%2Ftext%3E%3Ctext%20x%3D%2220%22%20y%3D%22129%22%20font-size%3D%2210%22%20fill%3D%22%2364748b%22%3E%E8%B5%B7%E5%A7%8B%E5%9C%B0%E5%9D%80%200x1000%3C%2Ftext%3E%3Crect%20x%3D%2217%22%20y%3D%22138%22%20width%3D%22136%22%20height%3D%2227%22%20rx%3D%224%22%20fill%3D%22%230D9488%22%20fill-opacity%3D%22.13%22%2F%3E%3Ctext%20x%3D%2225%22%20y%3D%22155%22%20font-size%3D%2211%22%20fill%3D%22currentColor%22%3EHealth%20%3D%20100%3C%2Ftext%3E%3Crect%20x%3D%22178%22%20y%3D%2295%22%20width%3D%22154%22%20height%3D%2280%22%20rx%3D%227%22%20fill%3D%22%2364748b%22%20fill-opacity%3D%22.07%22%20stroke%3D%22%2394a3b8%22%2F%3E%3Ctext%20x%3D%22190%22%20y%3D%22113%22%20font-size%3D%2212%22%20font-weight%3D%22600%22%20fill%3D%22currentColor%22%3EHeroB%3C%2Ftext%3E%3Ctext%20x%3D%22190%22%20y%3D%22129%22%20font-size%3D%2210%22%20fill%3D%22%2364748b%22%3E%E8%B5%B7%E5%A7%8B%E5%9C%B0%E5%9D%80%200x2000%3C%2Ftext%3E%3Crect%20x%3D%22187%22%20y%3D%22138%22%20width%3D%22136%22%20height%3D%2227%22%20rx%3D%224%22%20fill%3D%22%230D9488%22%20fill-opacity%3D%22.13%22%2F%3E%3Ctext%20x%3D%22195%22%20y%3D%22155%22%20font-size%3D%2211%22%20fill%3D%22currentColor%22%3EHealth%20%3D%2035%3C%2Ftext%3E%3C%2Fsvg%3E)

示意图：两个对象共享同一份属性描述，但各自存储不同的 `Health` 值。

对应的具体函数：

```cpp
float* HealthAddress = HealthProperty->ContainerPtrToValuePtr<float>(Object);
float Value = *HealthAddress;
```

先取地址，再读值。

### 如何写 `Health`？

假设已经找到了 `Health` 的描述 `HealthProperty`，需要指定修改哪个对象的值：

```cpp
HealthProperty->SetPropertyValue_InContainer(HeroA, 80.f);
```

### 如果是一个未知属性，如何判断类型？

通常情况下，属性面板开始拿到的是一个 `FProperty`，之后才判断它的类型。

```cpp
// 假设 Object 有效。
FProperty* Property = FindFProperty<FProperty>(Object->GetClass(), FName(TEXT("Health")));

if (FFloatProperty* FloatProperty = CastField<FFloatProperty>(Property))
{
    float Value = FloatProperty->GetPropertyValue_InContainer(Object);
}
```

`FProperty` 都是继承自 `FField` 的，因此使用 `CastField`。

> 但这里有一个疑问，因为不知道属性类型，又怎么确定该 `CastField` 什么类型呢？
>
> `CastField<FFloatProperty>` 只是尝试一种可能，并不是已经确定它是 `float`。
> 
> 通用属性面板会预先支持若干种类型，然后逐个判断：
> ```cpp
> if (FFloatProperty* FloatProperty = CastField<FFloatProperty>(Property))
> {
>     // 确认是 float 属性，才按 float 读取。
>     float Value = FloatProperty->GetPropertyValue_InContainer(Object);
>     // 显示浮点数输入框……
> }
> else if (FIntProperty* IntProperty = CastField<FIntProperty>(Property))
> {
>     int32 Value = IntProperty->GetPropertyValue_InContainer(Object);
>     // 显示整数输入框……
> }
> else if (FBoolProperty* BoolProperty = CastField<FBoolProperty>(Property))
> {
>     bool Value = BoolProperty->GetPropertyValue_InContainer(Object);
>     // 显示复选框……
> }
> else
> {
>     // 其他类型继续处理，或显示“暂不支持”。
> }
> ```

