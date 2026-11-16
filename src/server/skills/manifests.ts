/**
 * 四个 Skill 的声明。这是整个 Demo 的「能力清单」——是数据，不是代码。
 *
 * 之所以全部用 manifest 描述而不是写 if 分支：
 *  - Router 打分只依赖 triggers，不需要知道具体是哪个 Skill；
 *  - Composer 编排只依赖 requires / produces / namespace；
 *  - 冲突检测只依赖 conflictsWith / slot；
 *  - 界面上要能展示「系统认识哪些能力」，数据才能直接渲染。
 *
 * 词表是本项目可解释性的源头，必须能对老师讲清楚。所以：
 *  - primary 放「老师真的会说的话」（一次函数、滑块、练习题）
 *  - synonym 放同义与缩写（画、y=、选、填）
 *  - intent 放泛化诉求（演示）
 * 单字 synonym（`选` / `填`）是刻意保留的：它们会被更长的命中词遮蔽，
 * 用来验证「同一含义不会被两层词表各加一次分」这条规则。
 */

import type { SkillManifest } from '../../contracts/index';

export const SKILL_MANIFESTS: readonly SkillManifest[] = [
  {
    id: 'function-plot',
    displayName: '函数图像',
    summary: '按表达式画出一次函数图像，是可交互课件的可视化底座。',
    slot: 'visual',
    priority: 50,
    namespace: 'function-plot',
    triggers: {
      primary: ['一次函数', '函数图像', '图像', '画图'],
      synonyms: ['画', 'y=', '曲线'],
      intents: ['演示'],
    },
    produces: ['plot'],
    requires: [],
    conflictsWith: [],
    params: [
      { name: 'k', type: 'number', default: 2, min: -5, max: 5, step: 0.5, description: '斜率 k' },
      { name: 'b', type: 'number', default: 1, min: -5, max: 5, step: 0.5, description: '截距 b' },
    ],
  },
  {
    id: 'interactive-slider',
    displayName: '滑块联动',
    summary: '给学生一个可拖动的滑块，直接改变函数参数并实时重绘图像。',
    slot: 'interaction',
    priority: 60,
    namespace: 'interactive-slider',
    triggers: {
      primary: ['滑块', '拖动', '滑动'],
      synonyms: ['互动', '交互', '拉动'],
      intents: [],
    },
    produces: ['slider'],
    // 滑块必须有可绑定的图像，否则产出的 slider 无处可指
    requires: ['function-plot'],
    conflictsWith: [],
    params: [
      { name: 'rangeMin', type: 'number', default: -3, min: -10, max: 0, step: 0.5, description: '滑块下界' },
      { name: 'rangeMax', type: 'number', default: 3, min: 0, max: 10, step: 0.5, description: '滑块上界' },
      { name: 'step', type: 'number', default: 0.5, min: 0.1, max: 2, description: '拖动步长' },
    ],
  },
  {
    id: 'exercise-choice',
    displayName: '选择题',
    summary: '生成一道带选项的练习题，学生点击作答。',
    slot: 'exercise',
    priority: 50,
    namespace: 'exercise-choice',
    triggers: {
      primary: ['练习题', '选答案', '选择题'],
      synonyms: ['选', '选出'],
      intents: [],
    },
    produces: ['exercise'],
    requires: [],
    // 同一个题位只能有一种作答方式
    conflictsWith: ['exercise-input'],
    params: [{ name: 'optionCount', type: 'number', default: 4, min: 2, max: 6, description: '选项个数' }],
  },
  {
    id: 'exercise-input',
    displayName: '填空题',
    summary: '生成一道需要学生填写答案的练习题。',
    slot: 'exercise',
    priority: 50,
    namespace: 'exercise-input',
    triggers: {
      primary: ['练习题', '填答案', '填空题'],
      synonyms: ['填', '填入'],
      intents: [],
    },
    produces: ['exercise'],
    requires: [],
    conflictsWith: ['exercise-choice'],
    params: [{ name: 'blankCount', type: 'number', default: 1, min: 1, max: 5, description: '填空个数' }],
  },
];
