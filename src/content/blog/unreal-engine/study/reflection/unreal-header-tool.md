---
title: "Unreal Header Tool 源码解读"
description: ""
publishedAt: 2026-10-28
tags: ["Unreal Engine","source-reading", "Reflection", "UHT"]
draft: false
---

本文仅作为个人在学习过程中的记录，如有错误，欢迎指出！

## UE C++ 项目构建流程

UnrealBuildTool（UBT）组织构建

UHT 解析参与反射的头文件

生成 .generated.h、.gen.cpp 等文件

C++ 编译器编译手写代码与生成代码

链接为模块，加载后通过注册机制接入对象系统

## 常见宏

```cpp
// These macros wrap metadata parsed by the Unreal Header Tool, and are otherwise
// ignored when code containing them is compiled by the C++ compiler
#define UPROPERTY(...)
#define UFUNCTION(...)
#define USTRUCT(...)
#define UMETA(...)
#define UPARAM(...)
#define UENUM(...)
#define UDELEGATE(...)
#define RIGVM_METHOD(...)
```

如果从 C++ 预处理器的角度观察，会发现这些宏没有作用。但实际情况是 UHT 在 C++ 编译之前已经识别了原始头文件中的这些标记，通过这些标记生成了额外的代码。

## UHT

示例

```cpp
UCLASS(BlueprintType, MinimalAPI)
class UCurveFloat : public UCurveBase
{
    GENERATED_UCLASS_BODY()

    UPROPERTY()
    FRichCurve FloatCurve;

    UFUNCTION(BlueprintCallable, Category="Math|Curves")
    ENGINE_API float GetFloatValue(float InTime) const;
};
```

GENERATED_UCLASS_BODY() 是旧形式的类内生成宏，现代新类通常使用 GENERATED_BODY()。

BlueprintType 允许该类型作为蓝图变量类型；MinimalAPI 涉及模块间的 C++ 符号导出。

> **类型** 怎么理解？
>
> 类型描述信息，例如类名、父类、属性、函数。 
> 
> 类型元数据：在类型描述的信息基础上，补充编辑器、展示等蓝图行为说明。 

编辑器要把 GetFloatValue 提供给蓝图，至少得知道它属于哪个类、叫什么、接受什么参数、返回什么类型，以及是否允许蓝图调用。

因此可以将示例拆开来看：

1. class UCurveFloat : public UCurveBase
   
   UHT 会记录 源码类名、（引擎类型名）、父类标识，方便生成 类描述 与 父类依赖。

2. BlueprintType, MinimalAPI
   
   UHT 会记录 类型元数据、导出相关标记，决定类型暴露和部分代码生成行为。

3. GENERATED_UCLASS_BODY()
   
   UHT 会记录 生成宏所在行号

TODO：补全

### UHT 是如何解析一个类的

通俗来说，UHT 就是从左到右读文件，整理一份类型和成员的目录。

先创建一份“待填写的类描述”。

```c#
UhtClass classObj = new(parentScope.ScopeType, token.InputLine);
```

读取 UCLASS(...) 括号内的说明符，交给相应处理函数。

```c#
UhtSpecifierContext specifierContext = new(topScope, topScope.TokenReader, classObj.MetaData);
UhtSpecifierParser specifiers = UhtSpecifierParser.GetThreadInstance(specifierContext, ScopeName, parentScope.Session.GetSpecifierTable(UhtTableNames.Class));
specifiers.ParseSpecifiers();
```

此时检查是否读到了 class

> UCLASS()  →  class UCurveFloat : public UCurveBase

```c#
topScope.TokenReader.Require("class");
```

记录源码名 UCurveFloat，以及按 UE 命名规则拆出的引擎名 CurveFloat。

```c#
classObj.SourceName = topScope.TokenReader.GetIdentifier().Value.ToString();
classObj.EngineName = nameParts.EngineName.ToString();
```

记录父类标识 UCurveBase，并记录主要父类以外的基类名称，可以是 IMyInterface...

```c#
classObj.SuperIdentifier = superIdentifier;
classObj.BaseIdentifiers = baseIdentifiers;
```

表示本头文件中有 UCurveFloat 类，这里的 Outer 可以理解为头文件描述

```c#
classObj.Outer?.AddChild(classObj);
```

开始读取类体中的声明

```c#
topScope.HeaderParser.ParseStatements('{', '}', true);
```

## generated.h 必要的声明

