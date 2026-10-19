# 页面中英文切换

导航栏使用通用组件 `src/components/LanguageSwitch.astro`。组件按当前 URL 查找翻译配置：有非空配置时显示按钮，无配置或空配置时不渲染按钮。现有主页、文章布局、文章目录页与项目详情页均已接入。

在 `src/i18n/pages/` 新建 `.ts` 文件即可自动注册，无需修改组件或注册表。例如：

```ts
import type { PageTranslationConfig } from '../pages';

export default {
  path: '/project/swordworld/',
  messages: {
    '首页': 'Home',
    '游戏介绍': 'About the Game',
    '剑与世界 · 游戏开发作品 — Orca丶': 'Sword World — Orca丶',
  },
} satisfies PageTranslationConfig;
```

`path` 填写页面实际访问路径，末尾斜杠可省略。每个页面只能有一份配置，重复路径会在构建时报错。

`messages` 的键为原始中文，值为英文。支持文本节点、页面标题、描述、图片 alt 和 aria-label；未配置的内容保留原文。文本需匹配完整文本节点，跨段落或带内联标签的句子应按文本节点分别配置。不会替换代码、样式和语言按钮本身。

日期随所选语言格式化，语言偏好保存在 `orca-language`，跨已配置页面共享。无配置页面保持原始中文。配置只表示该页面可切换，并不自动生成翻译；新增页面时应补齐所需文案。

新建独立页面时，将 `<LanguageSwitch />` 放在导航栏最右侧；使用现有文章布局的页面无需再次接入。页面特殊排版需要自行适配较长的英文文案。

## 普通文章的英文正文

在 `src/content/blog-en/` 新建与中文 `src/content/blog/` 相同相对路径的英文 Markdown，即可自动开启该文章的切换按钮。沿用中文文章的 `publishedAt`、`tags` 和发布状态，翻译 `title`、`description` 及正文。两个版本在同一个 URL 下切换，目录随正文重新生成，代码折叠与图片预览可继续使用。

文章列表和源码解读专区自动从英文集合读取文章标题及描述，推荐卡片预览也从英文正文生成。搜索支持中英文标题，并随语言更新结果提示。代码和注释可保留原样；面向读者的文本示意图与 Mermaid 标签应翻译。

官方文档中文专区 `/article/unreal-engine/` 及其 `cpp/`、`gameplay-systems/` 文档不参与此集合，也不提供切换按钮。

普通页面中带数量等动态数据的纯文本可使用 `data-i18n-en="英文"`；成段的双语 HTML 可分别使用 `data-language-content="zh-CN"` 与 `data-language-content="en"`（英文默认 `hidden`）。切换后会触发 `site:language-change` 事件，动态交互可据此刷新。
