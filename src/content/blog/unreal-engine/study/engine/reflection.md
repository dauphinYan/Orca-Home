---
title: "反射系统"
description: ""
publishedAt: 2026-10-21
tags: ["Unreal Engine"]
draft: true
---

```cpp
void AStudyCharacter::BeginPlay()
{
	// Call the base class  
	Super::BeginPlay();
	
	UE_LOG(LogTemp, Warning, TEXT("GetClass() Name: %s"), *GetClass()->GetName());
	
	UE_LOG(LogTemp, Warning, TEXT("GetClass() Name: %s"), *AStudyCharacter::StaticClass()->GetName());
	
	UE_LOG(LogTemp, Warning, TEXT("GetClass() Name: %s"), *GetClass()->GetDefaultObject()->GetName());
}

```

输出结果：

```
LogTemp: Warning: GetClass() Name: BP_ThirdPersonCharacter_C
LogTemp: Warning: GetClass() Name: StudyCharacter
LogTemp: Warning: GetClass() Name: Default__BP_ThirdPersonCharacter_C
```