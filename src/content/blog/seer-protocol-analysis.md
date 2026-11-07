---
title: "赛尔号通信协议解析：源码解析与Hook注入"
description: "一次围绕 Flash 客户端、网络封包边界和 TCP 数据流处理的学习记录。"
publishedAt: 2025-07-18
tags:
  - 逆向工程
  - 网络通信
  - C++
---

文章内容完善中......

### 前言

作者是一名赛尔号PVP玩家，最近胜率一直不高，因此决定制作一款巅峰辅助工具。

本人此前从未接触过网络通信这一块，基本是现学现用，因此可能会存在部分问题，还望大佬们指出！

本文所用工具如下：

| 工具                        | 描述                |
| --------------------------- | ------------------- |
| Fiddler Classic             | 抓包工具            |
| JPEXS Free Flash Decompiler | Flash文件反编译工具 |
| x64dbg                      | 程序调试器          |

项目开源地址：https://github.com/dauphinYan/SeerAssistant

### 获取Flash文件并反编译

本阶段用到的工具：Fiddler Classic、JPEXS Free Flash Decompiler。

因不可抗因素，这部分暂时跳过......（可参考文末链接）

反编译成功后，我们会得到下述四个文件夹：

```
Client
RobotAppDLL
RobotCoreDLL
TaomeeLibrary
```

### 尝试读源码！

#### 通信数据解密

我们可以在前面反编译得到的`TaomeeLibrary`文件夹中搜索`socket`，毕竟网络通信都需要使用到`socket`，所以可以使用这种方法快速接近目标。然后，我们发现了十分显眼的`MDecrypt.as`，赶快进去瞧瞧！



可以看到`MDecrypt.as`的主要函数为：

```cpp
public function MDecrypt(param1:ByteArray, param2:int, param3:ByteArray) : void
```

因此我们需要弄清传入的三个参数对应的含义。

同样，在`TameeLibrary`文件夹中搜索`MDecrypt(`，这里有一个技巧，在末尾添加`(`就可以快速找到该函数在哪里实现以及调用。



现在可以清楚的看到在`MessageEncrypt.as`中有调用，我们进去看看。

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

通过这个函数实现，可以大胆猜测：

- `InData`：传入的数据包。
- `inLen`：真正需要解密的部分。
- `outData`：解密后的数据包。
- `NO_ENCRYPT_LEN`：记录数据包的长度信息。（这里大胆猜测，前四字节为包体长度）

> 为什么这么猜测呢？因为数据在传递的过程中，数据不是逐字节的发送的，而是以数据包的形式成批发送，那么发送方为了让接收方区分接收到的数据，通常会在数据包头部保留明文片段用于标识数据包的长度。

`MDecrypt.as`源码可读性比较差，有兴趣可以自行阅读分析，使用C++重写的源码可见下方。

C++重写后的解密源码：

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

不过有一点需要注意，在官方的源码中

```csharp
_loc11_ = CModule.mallocString(getDefinitionByName("com.robot.core.net.SocketConnection").key);
```

`_loc11_`在很多处都有参与运算，因此我们需要弄清楚这个值是怎么来的。

根据路径找到`SocketConnection.as`，发现关键函数`key()`：

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

不难知道，默认情况下`key`的值为`!crAckmE4nOthIng:-)`，这个密钥看着很像某些单词的缩写，简单解读一下。

- `crAckmE`：Crack me.
- `4`：for.
- `nOthIng`：Nothing.

连起来也就是：

```
Crack me for nothing.   试着破解我吧，反正也没啥有用的东西😊
```

> 这里感谢“圆圆圆”提供的解释。

显然，这个`key`在后面肯定会被修改，我们在这个文件中又找到的修改函数：

```c#
public static function setEncryptKeyStringArr(param1:Array) : void
{
_encryptKeyStringArr = param1;
}
```

因此在文件夹中搜索`setEncryptKeyStringArr(`，得到结果如下图所示：



只找到一处该方法的调用，和我们的预期有所差距：

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

可以看到这部分发生在与游戏服务器断开的阶段，并没有达到修改`key`的目的，现在就比较麻烦了。

既然如此，那我们先去开一把休息一下，羁绊后的伽马强度还是太爆炸了......



#### 数据包格式解析

在找`key`之前呢，可以先看看官方是如何解析数据包的，前面我们知道`MessageEncrypt.as`有一个`decrypt(`函数，很明显，这是一个套壳函数，没有解析数据的具体实现。因此文件夹中搜索`decrypt(`，可以定位到`SocketEncryptImpl.as`，其中包含一个函数：

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

在解密函数的下方，有一个`ParseData`函数，翻译过来就是”解析数据“。那么我们定位到那里去：

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

可以看到，Debug输出与`_headInfo`有关，那么同样的方式，我们定位到`HeadInfo`

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

再次阅读代码，现在封包的结构就十分明确了：

```csharp
// 封包长度, 4字节|版本号，1字节|命令号，4字节|用户号，4字节|序列号，4字节|包体数据

this._packageLen = data.readUnsignedInt();                        // 封包长度, 4字节

this._headInfo = new HeadInfo(data);                                // 头部信息，13字节

this._dataLen = this._packageLen - HEAD_LENGTH;                // 包体长度
```

这里补充一下，我们会发现在`parseData()`函数中，有一处命令ID的判断：

```c#
if(this._headInfo.cmdID == 1001)
{
    this._result = this._headInfo.result;
}
```

可以尝试在文件夹中搜索`cmdID`，接着我们会发现：



这里有一个`cmdID`的值为`41129`，接着我们继续搜索`41129`，然后我们会找到`CommandID.as`文件夹，这里面就包含了所有命令的ID，下面截取部分内容：

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

找到这个文件的方法有很多，这里只列举其中一种，最开始找到这个文件的方法我忘记了，上述方法是临时找的。

#### 找出修改Key的位置

回到这里，既然找不到修改`key`的位置，我们不妨先使用当前已经得到的解密算法对接收到的数据进行解密，这里选用`Hook`注入的方法（现在不清楚不用着急，后面会介绍的），解密得到的信息如下：

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

这里只截取正常的部分（`UserID`我就用"123456"代替了），从接收到`LOGIN_IN`指令以后，数据变得非常奇怪，也就是说，`key`值的改变发生在接收到`LOGIN_IN`指令后！

在文件夹中搜索`LOGIN_IN`，结果不多，挨个查看下，最后锁定在`MainEntry.as`：

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

然后我们会发现一个特别显眼的函数：`initKey(_loc4_)`

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

处理一下，就可以的得到：

```
_loc2_ = "com.robot.core.net.SocketConnection";
_loc3_ = "setEncryptKeyStringArr";
```

> 这种避免直接通过字符串搜索的方法学到了！

发现没，`_loc3_`就是我们前面只能找到一处调用的方法`setEncryptKeyStringArr`。

### 制作我们自己的Hook

#### 本文中有什么作用？

在本文中，我们的最终目的是对网络通信中的数据包进行解密，因此如何捕获数据非常重要。为了实现这一目的，就需要请出本节主角：Hook！

#### 什么是Hook?

Hook，又称钩子，是一种能够拦截和修改函数或方法的技术。它允许开发者在不修改原有的代码前提下，修改程序的行为。

例如在网络通信中，我们通过我们通过**Hook**拦截网络API的调用，例如`send`、`recv`等，这样就可以捕获网络通信中的一段**十六进制**数据：

```text
3c 3f 78 6d 6c 20 76 65 72 73 69 6f 6e 3d 22 31 2e 30 22 3f 3e 3c 21 44 4f 43 54 59 50 45 20 63 72 6f 73 73 2d 64 6f 6d 61 69 6e 2d 70 6f 6c 69 63 79 3e 3c 63 72 6f 73 73 2d 64 6f 6d 61 69 6e 2d 70 6f 6c 69 63 79 3e 3c 61 6c 6c 6f 77 2d 61 63 63 65 73 73 2d 66 72 6f 6d 20 64 6f 6d 61 69 6e 3d 22 2a 22 20 74 6f 2d 70 6f 72 74 73 3d 22 2a 22 20 2f 3e 3c 2f 63 72 6f 73 73 2d 64 6f 6d 61 69 6e 2d 70 6f 6c 69 63 79 3e 00
```

将其转换为**ASCII字符**就可以得到：

```xml
<?xml version="1.0"?>
<!DOCTYPE cross-domain-policy>
<cross-domain-policy>
    <allow-access-from domain="*" to-ports="*" />
</cross-domain-policy>
```

当然了，这个肯定是我们不需要的数据。

总的来说，**Hook**在本文的作用就是捕获我们需要分析的数据包。

#### Hook注入

一般情况下，**Hook**都是以**DLL**的形式注入到进程中，然后对进程进行修改，所以我们也需要制作**DLL**文件。

> 考虑到使用Windows原生API实现Hook难度不小，因此本文采用第三方开源库**MinHook**。
>
> 链接：https://github.com/TsudaKageyu/minhook

**MinHook**的实现就非常方便了，大致流程如下：

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

关于`MH_CreateHook`传入参数如何得到，请自行查看`SocketHook.cpp`。

那么我们该如何捕获数据呢？这里就以捕获接收包为例子：

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

#### 开始处理数据包！

现在接收到数据后，就需要想办法对数据进行处理了。

首先我创建了`PacketProcessor`类，用于处理这些数据。

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

在介绍最关键的`ProcessRecvPacket`前呢，需要先了解一些基础知识：**粘包**和**拆包**、**大端**和**小端**。

#### 粘包和拆包

在使用TCP协议进行数据传输的过程中，TCP会将发送方的数据存储在缓冲区中，并根据网络状况优化数据包的大小进行传输，也就是说，TCP一次传递报文段可能由**多个小的数据包组成**，接收方接收时就可能出现多个数据包“粘”在一起的现象，这种情况就是粘包；同样的，如果单个数据包过大，超过了TCP 报文段的最大传输单元，那么TCP会将这个**大的数据包拆分**，并分为多个报文段进行传输，这样就造成了拆包。

#### 大端和小端

大小端是**多字节数据的存储方式**，它决定一个多字节类型在内存中按照什么顺序存放各个字节。

简单来说，对于作为**正常人**的我们来说，对于`123`这个数字，我们都会将其读作“一百二十三”，也就是大端，即高位在前，低位在后；但是，**处理器**不这么认为，它是怎么读的呢？

“三百二十一”

也就是说，它与正常人读取的方式完全相反，高位在后，低位在前。下方是比较专业的例子：

```
整数 0x12345678 的字节排列：

地址:   0x00  0x01  0x02  0x03
大端:   0x12  0x34  0x56  0x78
小端:   0x78  0x56  0x34  0x12
```

#### ProcessRecvPacket

先贴代码

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

私以为其中的重点为**粘包**、**拆包**以及**登录包的处理**的解决方法。

先说**粘包**和**拆包**：

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

我创建了多个全局变量用于处理上述问题：

- `s_RecvBuf`：**接收缓冲区**，用于缓存接收来的数据流。
- `s_RecvBufIndex`：**当前**处理到的接收缓冲区**索引**。

大致流程如下：

1. 判头长，先判断包头长度是否足够，不够则继续等待新的包。
2. 读包头，将网络字节序（大端）转换为机器读法（小端）得到包长。
3. 判包长，判断当前缓冲区的包是否完整，不完整继续等。
4. 分析包，提取完整的数据包，进行解密分析。
5. 清库存，更新缓冲区的状态，确保不会影响下一轮的分析。

再说**登陆包的处理：**

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

非常的清晰，如果命令号为`1001`，就代表此时为登录包，然后依照官方处理方法，对`key`进行处理。

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

然后，我们就得到的关键道具：`key`。在这之后呢，所有的数据包的解密都会用到`key`，现在我们可以随意地捕获并解密封包了。

### 测试

登录阶段，可以看到`LOGIN_IN`指令分别进行了一次发送与一次接收。



尝试移动一下，可以看到`PEOPLE_WALK`分别被发送和接收了一次，至于日志中为什么是两次，因为第一次没截好图。



那么到这里，封包解密基本结束了，下面进入第二阶段：

**“对战信息捕获与UI展示”**

暂无...

### 最后

本文仅用于**技术研究与学习交流**，请勿用于任何商业用途。

所有相关资源版权归**上海淘米网络科技有限公司**所有。

如因滥用本文造成法律纠纷，**责任由使用者自行承担**。

本文参考自赛尔号：[通信协议逆向与模拟&中间人攻击窃取登录凭证](https://www.52pojie.cn/thread-1468888-1-1.html)

---

那么最后，赛尔号见！！！

---
