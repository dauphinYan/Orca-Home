---
title: "Reading the Unreal Engine Cast<T> Source Code"
description: "A source-level walkthrough of the type checks behind UE Cast<T>."
publishedAt: 2026-09-30
tags:
  - Unreal Engine
  - source-reading
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

## Examples

```cpp
AExampleActor* Actor = /* 有效对象 */;
IInteractable* Interactable = Cast<IInteractable>(Actor);
UObject* AsObject = Actor;

UFunction* Function = /* 一个 UFunction 对象 */;
UField* Field = Function;
```

| Return in the source | Example call | Why this path is taken |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Source interface → target interface: return `GetInterfaceAddress(...)` | `Cast<IDamageable>(Interactable)` | Retrieve `Actor` from `IInteractable*`, then obtain its `IDamageable*`. |
| Source interface → target is exactly `UObject`: `return Obj` | `Cast<UObject>(Interactable)` | `_getUObject()` has already retrieved the implementing object, so return it directly. |
| Source interface → target is a UObject subclass: `return (To*)Obj` | `Cast<AExampleActor>(Interactable)` | After retrieving the implementing object, `Obj->IsA<AExampleActor>()` succeeds. |
| Cast Flag path → compile-time upcast: `return (To*)Src` | `Cast<UField>(Function)` | `UFunction` inherits from `UField`, so the pointer can be upcast directly. |
| Cast Flag path → flag check succeeds: `return (To*)Src` | `Cast<UFunction>(Field)` | `Field` has static type `UField*` but points to a `UFunction`; the object's class carries `CASTCLASS_UFunction`. |
| General path → target interface: return `GetInterfaceAddress(...)` | `Cast<IInteractable>(AsObject)` | The source is `UObject*`; retrieve the object's `IInteractable` address. |
| General path → compile-time upcast: `return Src` | `Cast<UObject>(Actor)` | `AExampleActor` inherits from `UObject`, so return it directly. |
| General path → `IsA` succeeds: `return (To*)Src` | `Cast<AExampleActor>(AsObject)` | The static type is only `UObject*`; the runtime check finds that the actual object is an `AExampleActor`. |
| End of function: `return nullptr` | `Cast<AExampleActor>(PlainObject)`, where `PlainObject` is an ordinary `UObject` | The type check fails and no earlier branch returns. A null input also reaches this return. |

## Further Explanation

### _getUObject()

Retrieve the `UObject` that implements an interface from its interface pointer.

For example, `AMyActor` implements `IInteractable`. Because of multiple inheritance, pointers referring to the same object may have different addresses:

```
0x1000  ┌─ AMyActor object
        │  AActor / UObject subobject
0x1010  │  IInteractable subobject
        └─ End of object
```

> These addresses illustrate pointer adjustment with multiple inheritance. They do not represent the actual or a fixed memory layout of UE objects.

Thus, two pointers referring to the same object may have different numeric values:

```
UObject*        Obj       = 0x1000;
IInteractable*  Interface = 0x1010;
```

This method directly retrieves the `UObject` that implements the interface.

### Cast Flag

The official explanation is:

```
Flags used for quickly casting classes of certain types; all class cast flags are inherited
```

In other words, `EClassCastFlags` is a fast type-checking mechanism provided by UE for certain common core types, intended to avoid a full `IsA()` class hierarchy check.

For example:

```
UField
  ↑
UStruct
  ↑
UFunction
```

The `UClass::ClassCastFlags` for `UFunction` includes the relevant Cast Flags inherited from its base classes.

Official documentation: https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/CoreUObject/EClassCastFlags

## Questions

1. **When the input is an interface pointer, why retrieve its UObject first and then retrieve an interface pointer from that UObject?**

   For example, an `AExampleActor` implements two native UE interfaces. First obtain its `IInteractable*`, then cast that interface pointer to `IDamageable*`.

    ```cpp
   class AExampleActor
       : public AActor
       , public IInteractable
       , public IDamageable
           
   
   AExampleActor* Actor = /* 一个有效对象 */;
   
   IInteractable* Interactable = Cast<IInteractable>(Actor);
   IDamageable* Damageable = Cast<IDamageable>(Interactable);
    ```
   
   The conversion proceeds as follows:
   
   ```
   IInteractable*
         ↓ _getUObject()
      UObject*
         ↓ GetInterfaceAddress(IDamageable)
   IDamageable*
   ```
   
   

2. **What would go wrong if Cast checked the Cast Flag path before the interface conversion path?**

    When converting `IMyInterface*` to `AActor*`, a Cast Flag branch placed before the interface branch would mistake the interface address for a `UObject` address and could crash. Even if the check happened to succeed, the returned pointer could still be incorrect.

    For example:

    ```cpp
    IMyInterface* InterfacePtr = /* 指向某个 AMyActor 的接口 */;
    AActor* Actor = Cast<AActor>(InterfacePtr);
    ```

    Here, `TCastFlags<AActor>::Value` is nonzero (the flag is `CASTCLASS_AActor`), so execution enters the Cast Flag branch.

    ```cpp
    if (((const UObject*)Src)->GetClass()->HasAnyCastFlag(TCastFlags<To>::Value))
    {
        return (To*)Src;
    }
    ```

    Suppose:

    ```
    0x1000  Start of the AMyActor object (UObject / AActor subobject)
    0x1040  IMyInterface subobject within the object <- InterfacePtr, also Src
    ```

    It would then look for the member under the assumption that the `UObject` starts at `0x1040`, instead of using the correct `AMyActor` address.
