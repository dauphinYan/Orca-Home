---
title: "Unreal Engine Cast<T> 源码解读"
description: "从源码分析 UE Cast<T> 的类型判断流程。"
publishedAt: 2026-09-30
tags:
  - Unreal Engine
  - 源码解读
draft: false
---

## Cast

```cpp
// Dynamically cast an object type-safely.
template <typename To, typename From>
FORCEINLINE To* Cast(From* Src)
{
    // 检查两个类型是不是完整类型
	static_assert(sizeof(From) > 0 && sizeof(To) > 0, "Attempting to cast between incomplete types");

	if (Src)
	{
        // 如果是接口类型
		if constexpr (TIsIInterface<From>::Value)
		{
            // UE 接口指针背后关联着一个 UObject
			if (UObject* Obj = Src->_getUObject())
			{
                // 判断To是否是接口
				if constexpr (TIsIInterface<To>::Value)
				{
                    // 是接口，返回To接口指针
					return (To*)Obj->GetInterfaceAddress(To::UClassType::StaticClass());
				}
				else
				{
                    // 目标正好是 UObject 就直接返回对象
					if constexpr (std::is_same_v<To, UObject>)
					{
						return Obj;
					}
					else
					{
                        // 用 IsA<To>() 检查这个对象的实际类型是否属于 To
						if (Obj->IsA<To>())
						{
							return (To*)Obj;
						}
					}
				}
			}
		}
		else if constexpr (UE_USE_CAST_FLAGS && TCastFlags<To>::Value != CASTCLASS_None)
		{
            // From 在 C++ 静态类型关系上已经继承自 To，因此这是普通的向上转型，无须运行时类型检查。
			if constexpr (std::is_base_of_v<To, From>)
			{
				return (To*)Src;
			}
			else
			{
#if UE_ENABLE_UNRELATED_CAST_WARNINGS
				UE_STATIC_ASSERT_WARN((std::is_base_of_v<From, To>), "Attempting to use Cast<> on types that are not related");
#endif
                // 查对象所属的类有没有目标 Flag
				if (((const UObject*)Src)->GetClass()->HasAnyCastFlag(TCastFlags<To>::Value))
				{
					return (To*)Src;
				}
			}
		}
		else
		{
            // 一般 UObject 检查
            // 要求 From 是 UObject 的子类
			static_assert(std::is_base_of_v<UObject, From>, "Attempting to use Cast<> on a type that is not a UObject or an Interface");
			// 直接向对象取接口地址。没实现接口，就得到 nullptr
			if constexpr (TIsIInterface<To>::Value)
			{
				return (To*)((UObject*)Src)->GetInterfaceAddress(To::UClassType::StaticClass());
			} // 目标不是接口、并且 From 已经继承 To
			else if constexpr (std::is_base_of_v<To, From>)
			{
                // 安全的向上转型
				return Src;
			}
			else
			{
#if UE_ENABLE_UNRELATED_CAST_WARNINGS
				UE_STATIC_ASSERT_WARN((std::is_base_of_v<From, To>), "Attempting to use Cast<> on types that are not related");
#endif
                // 运行时检查
				if (((const UObject*)Src)->IsA<To>())
				{
                    // 
					return (To*)Src;
				}
			}
		}
	}

	return nullptr;
}
```

## 实例

```cpp
AExampleActor* Actor = /* 有效对象 */;
IInteractable* Interactable = Cast<IInteractable>(Actor);
UObject* AsObject = Actor;

UFunction* Function = /* 一个 UFunction 对象 */;
UField* Field = Function;
```

| 源码中的返回                                             | 调用例子                                                                    | 为什么走到这里                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 来源接口 → 目标接口：返回 `GetInterfaceAddress(...)`     | `Cast<IDamageable>(Interactable)`                                           | 先从 `IInteractable*` 找到 `Actor`，再取得它的 `IDamageable*`。                            |
| 来源接口 → 目标正好是 `UObject`：`return Obj`            | `Cast<UObject>(Interactable)`                                               | `_getUObject()` 已经得到所属对象，直接返回它。                                             |
| 来源接口 → 目标是 UObject 子类：`return (To*)Obj`        | `Cast<AExampleActor>(Interactable)`                                         | 找到所属对象后，`Obj->IsA<AExampleActor>()` 通过。                                         |
| Cast Flag 路径 → 编译期确定可向上转型：`return (To*)Src` | `Cast<UField>(Function)`                                                    | `UFunction` 继承 `UField`，指针可直接向上转型。                                            |
| Cast Flag 路径 → Flag 检查通过：`return (To*)Src`        | `Cast<UFunction>(Field)`                                                    | `Field` 的静态类型是 `UField*`，实际指向 `UFunction`；对象的类带有 `CASTCLASS_UFunction`。 |
| 通用路径 → 目标接口：返回 `GetInterfaceAddress(...)`     | `Cast<IInteractable>(AsObject)`                                             | 来源是 `UObject*`，从对象取得 `IInteractable` 的地址。                                     |
| 通用路径 → 编译期确定可向上转型：`return Src`            | `Cast<UObject>(Actor)`                                                      | `AExampleActor` 继承 `UObject`，直接返回。                                                 |
| 通用路径 → `IsA` 检查通过：`return (To*)Src`             | `Cast<AExampleActor>(AsObject)`                                             | 静态类型只有 `UObject*`，运行时发现实际对象是 `AExampleActor`。                            |
| 函数末尾：`return nullptr`                               | `Cast<AExampleActor>(PlainObject)`，其中 `PlainObject` 实际是普通 `UObject` | 类型检查没有通过，前面的分支都未返回。传入空指针也会走到这里。                             |

## 部分内容解释

### _getUObject()

从接口指针取得实现该接口的 `UObject` 对象。

例如，`AMyActor` 实现了 `IInteractable`。由于多重继承，指向同一个对象的指针可能位于不同地址：

```
0x1000  ┌─ AMyActor 对象
        │  AActor / UObject 部分
0x1010  │  IInteractable 部分
        └─ 对象结束
```

> 以下地址仅用于说明多重继承中的指针调整，不代表 UE 对象真实或固定的内存布局。

因此，指向同一个对象的两个指针，数值可能不同：

```
UObject*        Obj       = 0x1000;
IInteractable*  Interface = 0x1010;
```

通过该方法可以直接取得继承了这个接口的`UObject`对象。

### Cast Flag

官方的解释为：

```
Flags used for quickly casting classes of certain types; all class cast flags are inherited
```

也就是说 `EClassCastFlags` 本质上是 UE 为一部分常见核心类型准备的快速类型判断机制，目的是避免完整的 `IsA()` 类层级判断。

例如：

```
UField
  ↑
UStruct
  ↑
UFunction
```

`UFunction` 对应的 `UClass::ClassCastFlags` 会包含它继承得到的相关 Cast Flag。

官方文档可见：https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/CoreUObject/EClassCastFlags

## 疑问

1. **如果传进来的是一个接口指针，那么为什么还需要先获取这个 UObject，然后再获取这个 UObject的接口指针。**

   例如一个 `AExampleActor` 同时实现两个原生 UE 接口：先拿到它的 `IInteractable*`，再用这个接口指针转换成 `IDamageable*`。

    ```cpp
   class AExampleActor
       : public AActor
       , public IInteractable
       , public IDamageable
           
   
   AExampleActor* Actor = /* 一个有效对象 */;
   
   IInteractable* Interactable = Cast<IInteractable>(Actor);
   IDamageable* Damageable = Cast<IDamageable>(Interactable);
    ```
   
   转换流程如下：
   
   ```
   IInteractable*
         ↓ _getUObject()
      UObject*
         ↓ GetInterfaceAddress(IDamageable)
   IDamageable*
   ```
   
   

2. **如果 Cast 中先走 Cast Flag 这条路径，再走接口转换这条路径，会存在什么问题？**

    把 `IMyInterface*` 转成 `AActor*`：Cast Flag 分支若排在接口分支前面，会把接口的地址误当作 `UObject` 地址，可能崩溃；即使侥幸通过检查，返回的指针地址也可能是错的。

    例如：

    ```cpp
    IMyInterface* InterfacePtr = /* 指向某个 AMyActor 的接口 */;
    AActor* Actor = Cast<AActor>(InterfacePtr);
    ```

    走到这里时，`TCastFlags<AActor>::Value` 非空（此时的Flag == CASTCLASS_AActor），因此进入 Cast Flag 分支

    ```cpp
    if (((const UObject*)Src)->GetClass()->HasAnyCastFlag(TCastFlags<To>::Value))
    {
        return (To*)Src;
    }
    ```

    假如：

    ```
    0x1000  AMyActor 对象起始处（UObject / AActor 部分）
    0x1040  对象内的 IMyInterface 部分 ← InterfacePtr，也就是 Src
    ```

    此时它会按“`UObject` 从 `0x1040` 开始”的假设寻找该成员，而非正确的`AMyActor`。
