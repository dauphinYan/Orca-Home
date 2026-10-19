export const swordworld = {
  video: 'https://www.bilibili.com/video/BV1GpWA6tE1A/',
  player: 'https://player.bilibili.com/player.html?isOutside=true&aid=117432341498296&bvid=BV1GpWA6tE1A&cid=42703259296&p=1&autoplay=0',
  facts: [
    { label: '开发引擎', value: 'Unreal Engine 5.4' },
    { label: '开发周期', value: '两个月' },
    { label: '开发方式', value: '单人开发' },
    { label: '当前成果', value: '完整 Boss 战流程' },
  ],
  // 素材到位后填写图片地址与说明；图片放在 public/projects/swordworld/ 下。
  screenshots: [
    { title: '战斗全景', src: '', alt: '剑与世界战斗全景', caption: '' },
    { title: '交锋瞬间', src: '', alt: '剑与世界战斗细节', caption: '' },
    { title: '世界一角', src: '', alt: '剑与世界场景画面', caption: '' },
  ],
  introduction: '',
  responsibilities: '',
  sections: [
    { id: 'mechanics', number: '03', eyebrow: 'GAMEPLAY DESIGN', title: '游戏机制设计', summary: '从游戏规则，到可操作的战斗体验。', slots: [
      { title: '核心战斗机制', content: '' },
      { title: 'Boss 战流程', content: '' },
      { title: '操作与反馈', content: '' },
    ] },
    { id: 'architecture', number: '04', eyebrow: 'CLIENT ARCHITECTURE', title: '游戏代码架构', summary: '系统如何协作，一次操作如何走到最终反馈。', slots: [
      { title: '系统架构总览', content: '' },
      { title: '关键执行链路', content: '' },
      { title: '模块职责与设计取舍', content: '' },
    ] },
    { id: 'extensibility', number: '05', eyebrow: 'BUILT TO EXTEND', title: '可拓展性', summary: '通过具体的新增内容，展示系统的扩展方式。', slots: [
      { title: '数据与配置', content: '' },
      { title: '扩展案例', content: '' },
    ] },
    { id: 'challenges', number: '06', eyebrow: 'PROBLEM SOLVING', title: '技术难点与解决过程', summary: '', slots: [
      { title: '问题背景 → 解决方案 → 结果验证', content: '' },
    ] },
    { id: 'performance', number: '07', eyebrow: 'PERFORMANCE & RELIABILITY', title: '性能与稳定性', summary: '', slots: [
      { title: '测试环境、性能分析与稳定性验证', content: '' },
    ] },
  ],
  // 提供真实地址后自动显示入口，未提供时隐藏入口。
  repository: '',
  download: '',
};

