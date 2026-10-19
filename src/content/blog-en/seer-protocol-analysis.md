---
title: "Seer Communication Protocol Analysis: Source Reading and Hook Injection"
description: "A learning journal about the Flash client, network packet boundaries, and TCP stream processing."
publishedAt: 2026-09-10
tags:
  - 逆向工程
  - 网络通信
  - C++
---

This article is still being expanded...

### Introduction

As a Seer PvP player, I had been struggling with my win rate lately, so I decided to build an assistant for ranked battles.

I had never worked with network communication before this project and learned as I went. There may be mistakes, and corrections from experienced readers are welcome!

The tools used in this article are:

| Tool                        | Description                |
| --------------------------- | ------------------- |
| Fiddler Classic             | Packet capture tool            |
| JPEXS Free Flash Decompiler | Flash decompiler |
| x64dbg                      | Program debugger          |

Open-source project: https://github.com/dauphinYan/SeerAssistant

### Obtaining and Decompiling the Flash Files

Tools used in this stage: Fiddler Classic and JPEXS Free Flash Decompiler.

For reasons beyond my control, I am skipping this part for now... (See the reference link at the end.)

After decompilation, we get the following four folders:

```
Client
RobotAppDLL
RobotCoreDLL
TaomeeLibrary
```

### Reading the Source!

#### Decrypting Communication Data

Search for `socket` in the decompiled `TaomeeLibrary` folder. Network communication uses sockets, so this is a quick way to narrow down the search. The conspicuous `MDecrypt.as` soon turns up. Let's take a look!



The main function in `MDecrypt.as` is:

```cpp
public function MDecrypt(param1:ByteArray, param2:int, param3:ByteArray) : void
```

We therefore need to work out what its three parameters mean.

Likewise, search for `MDecrypt(` in the `TameeLibrary` folder. A useful trick is to include the trailing `(` to quickly find function definitions and call sites.



There is a clear call in `MessageEncrypt.as`. Let's open it.

```c#
private static var NO_ENCRYPT_LEN:int = 4;  

public static function decrypt(inData:ByteArray) : ByteArray
  {
     var inLen:int = inData.readUnsignedInt() - NO_ENCRYPT_LEN;
     var outData:ByteArray = new ByteArray();
     outData.writeUnsignedInt(0);
     MDecrypt(inData,inLen,outData);
     outData.position = 0;
     outData.writeUnsignedInt(outData.length);
     outData.position = 0;
     return outData;
  }
```

From this implementation, we can make a few educated guesses:

- `InData`: the incoming packet.
- `inLen`: the portion that actually needs decrypting.
- `outData`: the decrypted packet.
- `NO_ENCRYPT_LEN`: the length information in the packet. (My guess here is that the first four bytes contain the packet length.)

> Why this guess? Application data is sent in batches rather than as individually identifiable bytes. To let the receiver distinguish complete application packets, the sender commonly leaves an unencrypted length field in the packet header.

The source of `MDecrypt.as` is difficult to read. You can analyze it yourself if interested; my C++ rewrite is below.

The decryption code rewritten in C++:

```c++
std::vector<uint8_t> Cryptor::Decrypt(const std::vector<uint8_t> &Cipher)
{
    size_t len = Cipher.size();
    if (len == 0 || Key.empty())
        return {};

    // 计算旋转量
    int result = Key[(len - 1) % Key.size()] * 13 % len;

    // 环形右移 result 个字节
    std::vector<uint8_t> rotated = Merge(
        Slice(Cipher, len - result, len),
        Slice(Cipher, 0, len - result));

    // 右移/左移组合恢复原始字节序列（去掉最后一个字节）
    std::vector<uint8_t> plain(len - 1);
    for (size_t i = 0; i < len - 1; ++i)
    {
        plain[i] = static_cast<uint8_t>((rotated[i] >> 5) | (rotated[i + 1] << 3));
    }

    // 异或解密
    size_t j = 0;
    bool NeedBecomeZero = false;
    for (size_t i = 0; i < plain.size(); ++i)
    {
        if (j == 1 && NeedBecomeZero)
        {
            j = 0;
            NeedBecomeZero = false;
        }
        if (j == Key.size())
        {
            j = 0;
            NeedBecomeZero = true;
        }
        plain[i] = static_cast<uint8_t>(plain[i] ^ Key[j]);
        ++j;
    }

    return plain;
}
```

One detail in the official source needs attention:

```csharp
_loc11_ = CModule.mallocString(getDefinitionByName("com.robot.core.net.SocketConnection").key);
```

`_loc11_` participates in many calculations, so we need to find out where its value comes from.

Following the path to `SocketConnection.as` reveals the crucial `key()` function:

```c#
private static var _encryptKeyStringArr:Array;

public static function get key() : String
{
var _loc2_:int = 0;
var _loc3_:String = null;
var _loc1_:String = "";
if(_encryptKeyStringArr == null)
{
    _loc1_ = "!crAckmE4nOthIng:-)";
}
else
{
    _loc2_ = 0;
    while(_loc2_ < _encryptKeyStringArr.length)
    {
       _loc3_ = StringUtil.replace(_encryptKeyStringArr[_loc2_],"*","");
       _loc1_ += _loc3_;
       _loc2_++;
    }
}
return _loc1_;
}
```

The default `key` is clearly `!crAckmE4nOthIng:-)`. It looks like a phrase with abbreviations, so let's decode it:

- `crAckmE`：Crack me.
- `4`：for.
- `nOthIng`：Nothing.

Put together, it reads:

```
Crack me for nothing.   Try cracking me—there is nothing useful here anyway. 😊
```

> Thanks to “圆圆圆” for this explanation.

Clearly, this `key` must change later. In the same file, we find its setter:

```c#
public static function setEncryptKeyStringArr(param1:Array) : void
{
_encryptKeyStringArr = param1;
}
```

Searching the folder for `setEncryptKeyStringArr(` gives the result shown below:



There is only one call to this method, which is not what we expected:

```csharp
  private static function onSocketClose(param1:Event) : void
  {
     var event:Event = param1;
     DebugTrace.show("////////////////////////////////////////////////////////////////////////////////\r//\r//\t\t\t\t" + "socket was closed\r//\r////////////////////////////////////////////////////////////////////////////////");
     try
     {
        SocketConnection.mainSocket.removeEventListener(Event.CLOSE,onSocketClose);
        SocketConnection.setEncryptKeyStringArr(null);
        SocketConnectionHelper.clear();
        ModuleManager.hideAllModule();
        if(login10004)
        {
           return;
        }
        Alarm.show("此次连接已经断开，请重新登录",function():void
        {
           if(ExternalInterface.available)
           {
              navigateToURL(new URLRequest("javascript:window.location.reload();"),"_self");
           }
           else
           {
              navigateToURL(new URLRequest("https://seer.61.com"),"_self");
           }
        },false,true,false,LevelManager.stage);
     }
     catch(e:Error)
     {
     }
  }
```

This code runs when the connection to the game server closes. It does not explain how the active `key` changes, so things are getting tricky.

Time to take a break and play a match. Gamma is still ridiculously strong after unlocking its bond...



#### Analyzing the Packet Format

Before continuing our search for `key`, let's see how the official client parses packets. We already found `decrypt(` in `MessageEncrypt.as`, but it is only a wrapper without the actual parsing logic. Searching for `decrypt(` leads to `SocketEncryptImpl.as`, which contains this function:

```csharp
  private function onData(e:Event) : void
  {
     var msgLen:int = 0;
     var ba:ByteArray = null;
     DebugTrace.show("socket onData handler....................");
     this._chunkBuffer.clear();
     if(this._tempBuffer.length > 0)
     {
        this._tempBuffer.position = 0;
        this._tempBuffer.readBytes(this._chunkBuffer,0,this._tempBuffer.length);
        this._tempBuffer.clear();
     }
     readBytes(this._chunkBuffer,this._chunkBuffer.length,bytesAvailable);
     this._chunkBuffer.position = 0;
     while(this._chunkBuffer.bytesAvailable > 0)
     {
        if(this._chunkBuffer.bytesAvailable > MSG_FIRST_TOKEN_LEN)
        {
           msgLen = this._chunkBuffer.readUnsignedInt() - MSG_FIRST_TOKEN_LEN;
           if(this._chunkBuffer.bytesAvailable >= msgLen)
           {
              this._chunkBuffer.position -= MSG_FIRST_TOKEN_LEN;
              ba = MessageEncrypt.decrypt(this._chunkBuffer);                        // 在这里！
              this.parseData(ba);
           }
           else
           {
              this._chunkBuffer.position -= MSG_FIRST_TOKEN_LEN;
              this._chunkBuffer.readBytes(this._tempBuffer,0,this._chunkBuffer.bytesAvailable);
           }
        }
        else
        {
           this._chunkBuffer.readBytes(this._tempBuffer,0,this._chunkBuffer.bytesAvailable);
        }
     }
  }
```

Below the decryption call is `ParseData`, a function whose name suggests exactly what we need. Let's find it:

```csharp
private static const HEAD_LENGTH:uint = 17;

private function parseData(data:ByteArray) : void
  {
     var info:ByteArray = null;
     var tmfClass:Class = null;
     this._packageLen = data.readUnsignedInt();
     if(this._packageLen < HEAD_LENGTH || this._packageLen > PACKAGE_MAX)
     {
        this.readDataError(0);
        dispatchEvent(new SocketErrorEvent(SocketErrorEvent.ERROR,null));
        data.readBytes(new ByteArray());
        return;
     }
     this._headInfo = new HeadInfo(data);
     if(this._headInfo.cmdID == 1001)
     {
        this._result = this._headInfo.result;
     }
     DebugTrace.show("<<Socket[" + this.ip + ":" + this.port.toString() + "][cmdID:" + this._headInfo.cmdID + "]",getCmdLabel(this._headInfo.cmdID));
     if(this._headInfo.result > 1000)
     {
        this.readDataError(this._headInfo.cmdID);
        this.dispatchError(this._headInfo.cmdID,this._headInfo);
        dispatchEvent(new SocketErrorEvent(SocketErrorEvent.ERROR,this._headInfo));
        return;
     }
     this._dataLen = this._packageLen - HEAD_LENGTH;
     if(this._dataLen == 0)
     {
        this.readDataError(this._headInfo.cmdID);
        this.dispatchCmd(this._headInfo.cmdID,this._headInfo,null);
     }
     else
     {
        info = new ByteArray();
        data.readBytes(info,0,this._dataLen);
        tmfClass = TMF.getClass(this._headInfo.cmdID);
        this.readDataError(this._headInfo.cmdID);
        this.dispatchCmd(this._headInfo.cmdID,this._headInfo,new tmfClass(info));
     }
  }
```

The debug output depends on `_headInfo`, so we follow the same approach to locate `HeadInfo`:

```csharp
  public function HeadInfo(headData:IDataInput)
  {
     super();
     this._version = headData.readUTFBytes(1);                // 版本号，1字节
     this._cmdID = headData.readUnsignedInt();                // 命令号，4字节
     this._userID = headData.readUnsignedInt();                // 用户号，4字节
     this._result = headData.readInt();                                // 序列号，4字节
  }
```

Reading through the code again makes the packet structure clear:

```csharp
// 封包长度, 4字节|版本号，1字节|命令号，4字节|用户号，4字节|序列号，4字节|包体数据

this._packageLen = data.readUnsignedInt();                        // 封包长度, 4字节

this._headInfo = new HeadInfo(data);                                // 头部信息，13字节

this._dataLen = this._packageLen - HEAD_LENGTH;                // 包体长度
```

One more detail: `parseData()` checks a particular command ID:

```c#
if(this._headInfo.cmdID == 1001)
{
    this._result = this._headInfo.result;
}
```

Try searching the folder for `cmdID`. We then find:



One `cmdID` is `41129`. Searching for `41129` leads to `CommandID.as`, which contains all the command IDs. Here is an excerpt:

```c#
package com.robot.core
{
   public class CommandID
   {
      
      public static const LOADING_TIME_STAT:uint = 9303;
      
      public static const GET_PET_TOWER_ACHIEVE:uint = 3453;
      
      public static const RECEIVE_PRANKSTER_REWARD:uint = 1014;
      
      public static const TOPFIGHT_RANKING_LIST:uint = 2459;
      
      public static const TOPFIGHT_GET_AWARD:uint = 9374;
      
      public static const TOPFIGHT_WEEK_WIN:uint = 2532;
      
      public static const TOPFIGHT_BEYOND:uint = 2567;
   }
}
```

There are many ways to find this file; this is just one. I forgot how I originally found it, so I came up with the approach above while writing.

#### Finding Where the Key Changes

Since we cannot yet find where `key` changes, let's use the decryption algorithm we already have on incoming data. I use `Hook` injection here; don't worry if that is unfamiliar, as I will explain it later. The decrypted output is:

```text
[2025-07-03 15:22:54.849] [ThreadID 0xfb8] [Temp] [Hooked send] Parsed Data:[Length=17 Version=49 CmdID=111 Cmd=———— UserID=123456789 SN=0 BodySize=0]
[2025-07-03 15:22:54.874] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=21 Version=0 CmdID=111 Cmd=———— UserID=123456789 SN=0 BodySize=4] Body=[00 00 00 00 ]
[2025-07-03 15:22:54.878] [ThreadID 0xfb8] [Temp] [Hooked send] Parsed Data:[Length=37 Version=49 CmdID=109 Cmd=SYS_ROLE UserID=123456789 SN=0 BodySize=20] Body=[a4 0e a7 cc 84 21 87 f2 f6 91 51 9a 7a 0e b7 6e ...]
[2025-07-03 15:22:54.903] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=21 Version=0 CmdID=109 Cmd=SYS_ROLE UserID=123456789 SN=0 BodySize=4] Body=[00 00 00 00 ]
[2025-07-03 15:22:54.905] [ThreadID 0xfb8] [Temp] [Hooked send] Parsed Data:[Length=37 Version=49 CmdID=105 Cmd=COMMEND_ONLINE UserID=123456789 SN=0 BodySize=20] Body=[a4 0e a7 cc 84 21 87 f2 f6 91 51 9a 7a 0e b7 6e ...]
[2025-07-03 15:22:54.934] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=561 Version=0 CmdID=105 Cmd=COMMEND_ONLINE UserID=123456789 SN=0 BodySize=544] Body=[00 00 0b 99 00 00 00 03 00 79 ec 33 00 00 00 02 ...]
[2025-07-03 15:23:06.439] [ThreadID 0xfb8] [Temp] [Hooked send] Parsed Data:[Length=141 Version=49 CmdID=1001 Cmd=LOGIN_IN UserID=123456789 SN=202 BodySize=124] Body=[a4 0e a7 cc 84 21 87 f2 f6 91 51 9a 7a 0e b7 6e ...]
[2025-07-03 15:23:06.989] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=171 Version=62 CmdID=8002 Cmd=SYSTEM_MESSAGE UserID=123456789 SN=0 BodySize=154] Body=[00 01 88 43 68 66 2f da 00 00 00 8e 20 e7 b2 be ...]
[2025-07-03 15:23:06.995] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=171 Version=62 CmdID=8002 Cmd=SYSTEM_MESSAGE UserID=123456789 SN=0 BodySize=154] Body=[00 01 88 43 68 66 2f da 00 00 00 8e 20 e7 b2 be ...]
[2025-07-03 15:23:06.996] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=113 Version=62 CmdID=8002 Cmd=SYSTEM_MESSAGE UserID=123456789 SN=0 BodySize=96] Body=[00 01 88 43 68 66 2f da 00 00 00 54 e5 a6 82 e6 ...]
[2025-07-03 15:23:06.996] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=129 Version=62 CmdID=8002 Cmd=SYSTEM_MESSAGE UserID=123456789 SN=0 BodySize=112] Body=[00 00 00 03 68 66 2f da 00 00 00 64 20 e4 bd a0 ...]
[2025-07-03 15:23:06.997] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=25 Version=62 CmdID=3452 Cmd=LASTVALUE UserID=123456789 SN=0 BodySize=8] Body=[00 00 00 7f 00 00 00 32 ]
[2025-07-03 15:23:06.997] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=25 Version=62 CmdID=3452 Cmd=LASTVALUE UserID=123456789 SN=0 BodySize=8] Body=[00 00 00 63 00 00 00 02 ]
[2025-07-03 15:23:06.997] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=25 Version=62 CmdID=2394 Cmd=PET_BOOK_UPDATE UserID=123456789 SN=0 BodySize=8] Body=[00 00 05 1c 00 00 00 01 ]
[2025-07-03 15:23:06.998] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=25 Version=62 CmdID=3452 Cmd=LASTVALUE UserID=123456789 SN=0 BodySize=8] Body=[00 00 00 2b 00 00 00 3c ]
[2025-07-03 15:23:06.998] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=25 Version=62 CmdID=3452 Cmd=LASTVALUE UserID=123456789 SN=0 BodySize=8] Body=[00 00 00 2b 00 00 00 00 ]
[2025-07-03 15:23:06.998] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=25 Version=62 CmdID=3452 Cmd=LASTVALUE UserID=123456789 SN=0 BodySize=8] Body=[00 00 00 2b 00 00 01 54 ]
[2025-07-03 15:23:06.998] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=25 Version=62 CmdID=3452 Cmd=LASTVALUE UserID=123456789 SN=0 BodySize=8] Body=[00 00 00 2b 00 00 08 8b ]
[2025-07-03 15:23:06.999] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=25 Version=62 CmdID=3452 Cmd=LASTVALUE UserID=123456789 SN=0 BodySize=8] Body=[00 00 00 2b 00 00 0a 31 ]
[2025-07-03 15:23:07.031] [ThreadID 0xfb8] [Temp] [Hooked recv] Parsed Data:[Length=3413 Version=62 CmdID=1001 Cmd=LOGIN_IN UserID=123456789 SN=46 BodySize=3396] Body=[0d b2 32 92 4d 71 dc 79 e7 89 9b e6 8e 92 00 00 ...]
```

Only the normal-looking portion is shown here (`UserID` has been replaced with “123456”). After the `LOGIN_IN` command arrives, the data becomes very strange. This suggests that `key` changes after receiving `LOGIN_IN`!

Searching for `LOGIN_IN` returns only a few results. After inspecting them, we narrow it down to `MainEntry.as`:

```c#
  private static function onLogin(param1:SocketEvent) : void
  {
     if(SaveUserInfo.loginIDInfo.loginType == 3)
     {
        StatManager.sendStat2014("手机验证码注册/登录","【手机验证码登录玩家】登录ONLINE服","手机验证码");
     }
     if(MainManager.isNewUser)
     {
        StatManager.sendStat2014("_newtrans_","fOnlineSucc","");
     }
     if(!isReconnect)
     {
        SocketConnection.removeCmdListener(CommandID.LOGIN_IN,onLogin);
        EventManager.addEventListener(RobotEvent.CREATED_ACTOR,onCreatedActor);
     }
     else
     {
        SocketConnection.removeCmdListener(CommandID.RELOGIN_IN,onLogin);
     }
     var _loc2_:int = 0;
     if(isReconnect)
     {
        _loc2_ = int(MainManager.actorInfo.mapID);
     }
     MainManager.setup(param1.data,isReconnect,_loc2_);
     var _loc3_:ByteArray = param1.data as ByteArray;
     var _loc4_:int = int(_loc3_.readUnsignedInt());
     initKey(_loc4_);
     MainEntry.login10004 = false;
     LevelManager.openMouseEvent();
     if(isReconnect)
     {
        MainManager.reconnectRequest();
        EventManager.dispatchEvent(new Event(ReconnectCompleteController.RECONNECTSUC));
     }
     if(!isReconnect)
     {
        MapConfig.setup();
        MapSeatPointConfig.setup();
     }
     sendSystemInfo();
     SocketConnection.send(1022,86066824);
  }
```

One function stands out immediately: `initKey(_loc4_)`.

```csharp
  private static function initKey(param1:int) : void
  {
     var _loc2_:String = "c&o&m.--rob-ot.c--o-r-e.&n-et.S-oc-ke-t&C-on-n-e-c-t-i-on";
     var _loc3_:* = "s*e*tE&&&n*c";
     _loc3_ += "r*yp*t&&&&Ke*yS*tr*i&n&&g*Arr";
     _loc2_ = StringUtil.replace(_loc2_,"-","");
     _loc2_ = StringUtil.replace(_loc2_,"&","");
     _loc3_ = StringUtil.replace(_loc3_,"*","");
     _loc3_ = StringUtil.replace(_loc3_,"&","");
     param1 ^= MainManager.actorInfo.userID;
     var _loc4_:String = MD5.hash(param1 + "");
     var _loc5_:* = MainManager.actorInfo.userID + "";
     var _loc6_:Array = [];
     var _loc7_:int = 0;
     while(_loc7_ < 10)
     {
        _loc6_[_loc7_] = "*" + _loc4_.charAt(_loc7_) + "*";
        _loc7_++;
     }
     getDefinitionByName(_loc2_)[_loc3_](_loc6_);
  }
```

After simplifying the strings, we get:

```
_loc2_ = "com.robot.core.net.SocketConnection";
_loc3_ = "setEncryptKeyStringArr";
```

> A useful lesson in avoiding direct string searches!

Notice that `_loc3_` is `setEncryptKeyStringArr`, the method for which we previously found only one call.

### Building Our Own Hook

#### What Does It Do Here?

Our goal is to decrypt packets exchanged over the network, so capturing the data is essential. That brings us to the main tool of this section: hooks!

#### What Is a Hook?

A hook is a technique for intercepting and modifying function or method calls. It allows developers to change a program's behavior without editing its original source code.

For network communication, we can **hook** network APIs such as `send` and `recv` to capture a sequence of **hexadecimal** bytes:

```text
3c 3f 78 6d 6c 20 76 65 72 73 69 6f 6e 3d 22 31 2e 30 22 3f 3e 3c 21 44 4f 43 54 59 50 45 20 63 72 6f 73 73 2d 64 6f 6d 61 69 6e 2d 70 6f 6c 69 63 79 3e 3c 63 72 6f 73 73 2d 64 6f 6d 61 69 6e 2d 70 6f 6c 69 63 79 3e 3c 61 6c 6c 6f 77 2d 61 63 63 65 73 73 2d 66 72 6f 6d 20 64 6f 6d 61 69 6e 3d 22 2a 22 20 74 6f 2d 70 6f 72 74 73 3d 22 2a 22 20 2f 3e 3c 2f 63 72 6f 73 73 2d 64 6f 6d 61 69 6e 2d 70 6f 6c 69 63 79 3e 00
```

Converting them to **ASCII characters** gives:

```xml
<?xml version="1.0"?>
<!DOCTYPE cross-domain-policy>
<cross-domain-policy>
    <allow-access-from domain="*" to-ports="*" />
</cross-domain-policy>
```

Of course, this is not the data we are looking for.

The role of the **hook** in this article is to capture the packets we want to analyze.

#### Hook Injection

Hooks are commonly injected into a process as a **DLL**, which then modifies the process's behavior. We therefore need to build a **DLL** as well.

> Implementing hooks with native Windows APIs is fairly involved, so this article uses the third-party open-source library **MinHook**.
>
> Link: https://github.com/TsudaKageyu/minhook

**MinHook** makes this straightforward. The general flow is:

```cpp
// 初始化
MH_STATUS WINAPI MH_Initialize(VOID);

// 创建钩子 pTarget：需要替换的目标函数地址。 pDetour：我们自己创建的函数地址。 ppOriginal：用于保存原始函数地址（方便绕过Hook）
MH_STATUS WINAPI MH_CreateHook(LPVOID pTarget, LPVOID pDetour, LPVOID *ppOriginal);

// 启动钩子
MH_STATUS WINAPI MH_EnableHook(LPVOID pTarget)

// 关闭钩子
MH_STATUS WINAPI MH_DisableHook(LPVOID pTarget)
   
// 收工后的一些处理
MH_STATUS WINAPI MH_Uninitialize(VOID);
```

See `SocketHook.cpp` for how the arguments passed to `MH_CreateHook` are obtained.

How do we capture the data? Here is an example for incoming packets:

```cpp
/*
S：当前接收数据的端点。
BufferPtr：指向缓冲区的指针，存放S接收的数据。
Length：缓冲区的大小。
Flag：接收标志位，控制接收方式。（本文没有用到）
*/
int WINAPI RecvEvent(SOCKET S, char *BufferPtr, int Length, int Flag)
{
    int Result = OriginalRecv(S, BufferPtr, Length, Flag); // 实际接收到的长度。

    if (g_hookEnabled && Result > 0)
    {
        std::lock_guard<std::mutex> lock(g_DataMutex);

        std::vector<char> Temp(BufferPtr, BufferPtr + Result);
               
        // 处理本次接收到的数据。
        PacketProcessor::ProcessRecvPacket(S, Temp, Result);
    }

    return Result;
}
```

#### Processing the Packets!

Once we receive data, we need a way to process it.

First, I created a `PacketProcessor` class for that purpose.

```cpp
struct PacketData
{
    int32_t Length;  // 包长 4字节
    uint8_t Version; // 版本 1字节
    int32_t CmdID;   // 命令号 4字节
    int32_t UserID;  // 米米号 4字节
    int32_t SN;      // 序列号 4字节
    std::vector<uint8_t> Body;

    void LogCout(bool bIsSend) const;
};

class PacketProcessor
{
public:
    static void ProcessRecvPacket(SOCKET Socket, const vector<char> &Data, int Length);

    static PacketData ParsePacket(const vector<uint8_t> &Packet);

    static bool ShouldDecrypt(const vector<uint8_t> &Cipher);
    static vector<uint8_t> DecryptPacket(const vector<uint8_t> &Cipher);

    static void Logining(PacketData &InPacketData);

private:
    static vector<uint8_t> s_RecvBuf;
    static size_t s_RecvBufIndex;
    static size_t s_RecvBufLen;
    static size_t s_RecvNum;
    static SOCKET s_CurrentSocket;
    static bool s_HaveLogin;
    static size_t s_SN;
    static int32_t s_UserID;
};
```

Before discussing the key function, `ProcessRecvPacket`, we need some background: **packet coalescing**, **packet splitting**, **big-endian**, and **little-endian** byte order.

#### Packet Coalescing and Splitting

When TCP transfers data, it buffers the sender's bytes and adjusts transmission to network conditions. A received chunk can contain **multiple small application packets**, so their bytes appear “stuck” together; this is commonly called packet coalescing. Conversely, TCP may **split a large application packet** across multiple segments, so a receiver may need several reads to assemble it. Application packet boundaries must therefore be reconstructed from the byte stream.

#### Big-Endian and Little-Endian

Endianness describes **how multibyte data is stored**: it determines the order of the bytes of a multibyte value in memory.

As an analogy, we normally read `123` as “one hundred and twenty-three,” with the most significant digit first, similar to big-endian ordering. A processor using little-endian ordering instead puts the least significant part first—roughly like reading:

“Three hundred and twenty-one.”

In other words, the ordering is reversed: the most significant part comes last. Here is a more precise byte-level example:

```
Byte layout of the integer 0x12345678:

Address:  0x00  0x01  0x02  0x03
Big-endian:    0x12  0x34  0x56  0x78
Little-endian: 0x78  0x56  0x34  0x12
```

#### ProcessRecvPacket

First, the code:

```cpp
void PacketProcessor::ProcessRecvPacket(SOCKET Socket, const vector<char> &Data, int Length)
{
    PacketData RecvPacketData = PacketData();

    s_RecvBuf.insert(s_RecvBuf.end(), Data.begin(), Data.begin() + Length);

    // 是否是同一连接。
    if (s_CurrentSocket != Socket)
    {
        s_RecvBufIndex += Length;

        // 此时索引等于缓冲区长度，则说明刚好取完此包。
        if (s_RecvBufIndex == s_RecvBuf.size())
        {
            s_RecvBuf.clear();
            s_RecvBufIndex = 0;
        }

        return;
    }

    while (true)
    {
        size_t Remain = s_RecvBuf.size() - s_RecvBufIndex;

        // 不足包头长度，需等待。
        if (Remain < sizeof(uint32_t))
            break;

        // 读包。
        uint32_t PacketLength = 0;
        memcpy(&PacketLength, &s_RecvBuf[s_RecvBufIndex], sizeof(PacketLength));
        PacketLength = ntohl(PacketLength);

        // 包未齐，需等待。
        if (Remain < PacketLength)
            break;

        vector<uint8_t> Cipher(s_RecvBuf.begin() + s_RecvBufIndex, s_RecvBuf.begin() + s_RecvBufIndex + PacketLength);

        vector<uint8_t> Plain = ShouldDecrypt(Cipher) ? DecryptPacket(Cipher) : Cipher;

        RecvPacketData = ParsePacket(Plain);
        ++s_RecvNum;
        RecvPacketData.LogCout(false);

        // 如果是登录包
        if (RecvPacketData.CmdID == 1001)
        {
            Logining(RecvPacketData);
            s_CurrentSocket = Socket;
            s_SN = RecvPacketData.SN;
            s_UserID = RecvPacketData.UserID;
            s_HaveLogin = true;
        }

        s_RecvBufIndex += PacketLength;

        if (s_RecvBufIndex == s_RecvBuf.size())
        {
            s_RecvBuf.clear();
            s_RecvBufIndex = 0;
            break;
        }

        if (s_RecvBufIndex > 0)
        {
            s_RecvBuf.erase(s_RecvBuf.begin(), s_RecvBuf.begin() + s_RecvBufIndex);
            s_RecvBufIndex = 0;
            // s_CurrentSocket = Socket;
        }
    }
}
```

To me, the key parts are the handling of **coalesced packets**, **split packets**, and **login packets**.

Let's start with **coalescing** and **splitting**:

```cpp
while (true)
{
    size_t Remain = s_RecvBuf.size() - s_RecvBufIndex;

    // 不足包头长度，需等待。
    if (Remain < sizeof(uint32_t))
        break;

    // 读包。
    uint32_t PacketLength = 0;
    memcpy(&PacketLength, &s_RecvBuf[s_RecvBufIndex], sizeof(PacketLength));
    PacketLength = ntohl(PacketLength);

    // 包未齐，需等待。
    if (Remain < PacketLength)
        break;

    vector<uint8_t> Cipher(s_RecvBuf.begin() + s_RecvBufIndex, s_RecvBuf.begin() + s_RecvBufIndex + PacketLength);

    vector<uint8_t> Plain = ShouldDecrypt(Cipher) ? DecryptPacket(Cipher) : Cipher;

    RecvPacketData = ParsePacket(Plain);
    ++s_RecvNum;
    RecvPacketData.LogCout(false);

    // 如果是登录包
    if (RecvPacketData.CmdID == 1001)
    {
        Logining(RecvPacketData);
        s_CurrentSocket = Socket;
        s_SN = RecvPacketData.SN;
        s_UserID = RecvPacketData.UserID;
        s_HaveLogin = true;
    }

    s_RecvBufIndex += PacketLength;

    if (s_RecvBufIndex == s_RecvBuf.size())
    {
        s_RecvBuf.clear();
        s_RecvBufIndex = 0;
        break;
    }

    if (s_RecvBufIndex > 0)
    {
        s_RecvBuf.erase(s_RecvBuf.begin(), s_RecvBuf.begin() + s_RecvBufIndex);
        s_RecvBufIndex = 0;
        // s_CurrentSocket = Socket;
    }
```

I created several global variables to handle these cases:

- `s_RecvBuf`: the **receive buffer**, which stores the incoming byte stream.
- `s_RecvBufIndex`: the **index** currently being processed in the receive buffer.

The general flow is:

1. Check the header size. If there are not enough bytes, wait for more data.
2. Read the header and convert the packet length from network byte order (big-endian) to the machine's byte order (little-endian here).
3. Check the packet length. If the buffer does not contain the complete packet, keep waiting.
4. Extract the complete packet, decrypt it, and analyze it.
5. Update the buffer state so the next iteration can proceed correctly.

Next, **handling login packets:**

```cpp
if (RecvPacketData.CmdID == 1001)
{
    Logining(RecvPacketData);
    s_CurrentSocket = Socket;
    s_SN = RecvPacketData.SN;
    s_UserID = RecvPacketData.UserID;
    s_HaveLogin = true;
}
```

This is straightforward: command `1001` identifies a login packet. We then derive `key` using the official client's procedure.

```cpp
void PacketProcessor::Logining(PacketData &InPacketData)
{
    if (InPacketData.Body.size() < 4)
    {
        return;
    }

    // 1. 取尾 4 字节并按“大端”组装
    size_t n = InPacketData.Body.size();
    uint32_t tail4 = (static_cast<uint32_t>(InPacketData.Body[n - 1])) | (static_cast<uint32_t>(InPacketData.Body[n - 2]) << 8) | (static_cast<uint32_t>(InPacketData.Body[n - 3]) << 16) | (static_cast<uint32_t>(InPacketData.Body[n - 4]) << 24);

    // 2. 异或 userId
    uint32_t xorRes = tail4 ^ static_cast<uint32_t>(InPacketData.UserID);

    // 3. 转为字符串
    std::string plain = std::to_string(xorRes);

    // 4. 计算 MD5
    MD5 md5;
    md5.update(reinterpret_cast<const uint8_t *>(plain.data()), plain.size());
    md5.finalize();
    std::string md5hex = md5.hexdigest();

    // 5. 取前 10 字符作密钥
    std::string key = md5hex.substr(0, 10);

    // 初始化加密算法
    Cryptor::InitKey(key);
}
```

That gives us the crucial piece: `key`. Subsequent packets are decrypted with this key, so we can now capture and decrypt them.

### Testing

During login, we can see one outgoing and one incoming `LOGIN_IN` command.



After moving the character, we see `PEOPLE_WALK` sent and received. The log shows it twice because my first screenshot attempt did not work out.



Packet decryption is now essentially complete. Next comes the second stage:

**“Capturing Battle Information and Displaying It in the UI”**

Coming soon...

### Closing Notes

This article is for **technical research, learning, and discussion** only. Do not use it for commercial purposes.

All related resources are copyrighted by **Shanghai Taomee Network Technology Co., Ltd.**

If misuse of this article leads to legal disputes, **the user bears responsibility**.

Reference: [Seer: Reverse Engineering and Simulating the Communication Protocol & Stealing Login Credentials with a Man-in-the-Middle Attack](https://www.52pojie.cn/thread-1468888-1-1.html)

---

See you in Seer!!!

---
