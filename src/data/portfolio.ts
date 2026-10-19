import lockCover from '../assets/projects/lock-knock/cover-horizontal.jpg?url';
import seerCover from '../assets/projects/seer-assistant/seer-assistant-screenshot.png?url';
import avatar from '../assets/profile/hinami-aoi.jpg?url';

export const profile = {
  name: 'Orca丶',
  github: 'https://github.com/dauphinYan',
  bilibili: 'https://space.bilibili.com/285301431',
  email: 'dauphinyan@foxmail.com',
  emailLabel: 'Foxmail',
  gmail: 'dauphinyan03@gmail.com',
  abstract: '一个特别想做出自己游戏的菜鸟程序员，不擅长与人打交道、讨厌太多世俗规矩。',
  avatar,
};

export const projects = [
  {
    title: '剑与世界', key: 'sword', tags: ['Unreal Engine 5.4', '单人开发', 'Boss 战'],
    description: '历时两个月，使用 Unreal Engine 5.4 单人开发，实现完整 Boss 战流程。',
    image: null, href: '/project/swordworld/', status: '重点作品',
  },
  {
    title: '洛克的迷宫', key: 'lockknock',
    tags: ['Unreal Engine', '探索', '迷宫', '角色扮演'],
    description: '探索克苏鲁风格的诡异迷宫，躲避恶灵与怪物的追杀。',
    image: lockCover, href: '/project/lockknock/', status: null,
  },
  {
    title: '赛尔号记牌器', key: 'seer', tags: ['逆向', 'QT'],
    description: '游戏辅助，通过抓取网络数据包，解析数据，实现对战信息记录，帮助新手玩家。',
    image: seerCover, href: null, status: '累计下载 3000+ 次',
  },
];
