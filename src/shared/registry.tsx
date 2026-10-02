// 工具注册表：popup 与全屏页共享的唯一导航源（按分组组织）
import type { ComponentType, ReactNode } from 'react';
import {
  BankOutlined, ClockCircleOutlined, CodeOutlined, ClusterOutlined, DatabaseOutlined,
  GlobalOutlined, LinkOutlined,
} from '@ant-design/icons';
import { CompanyTool } from '../tools/company/CompanyTool';
import { UrlTool } from '../tools/url/UrlTool';
import { TimestampTool } from '../tools/timestamp/TimestampTool';
import { JsonTool } from '../tools/json/JsonTool';
import { CorsTool } from '../tools/cors/CorsTool';
import { NetRecordTool } from '../tools/netrecord/NetRecordTool';
import { FrameStoreTool } from '../tools/framestore/FrameStoreTool';

export interface ToolMeta {
  id: string;
  title: string;
  /** 副标题（popup 首页卡片与全屏侧边栏提示） */
  subtitle: string;
  icon: ReactNode;
  component: ComponentType;
  /** 全屏页底部说明标签（如国标依据），无则不渲染 */
  tags?: string[];
  /** 全屏页取消 max-width，适合表格/分栏类工具 */
  wide?: boolean;
}

export interface ToolGroup {
  id: string;
  title: string;
  tools: ToolMeta[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'basic',
    title: '基础工具',
    tools: [
      { id: 'company', title: '企业信息', subtitle: '名称与统一社会信用代码', icon: <BankOutlined />, component: CompanyTool, tags: ['GB 32100-2015 统一社会信用代码', 'GB 11714 组织机构代码', 'GB 11643 居民身份证', 'Manifest V3'] },
      { id: 'url', title: 'URL 编解码', subtitle: 'encode / decode', icon: <LinkOutlined />, component: UrlTool },
      { id: 'timestamp', title: '时间戳转换', subtitle: '时间戳与时间互转', icon: <ClockCircleOutlined />, component: TimestampTool },
      { id: 'json', title: 'JSON 工具', subtitle: '格式化 / 压缩 / 校验', icon: <CodeOutlined />, component: JsonTool },
    ],
  },
  {
    id: 'network',
    title: '网络工具',
    tools: [
      { id: 'cors', title: 'CORS 绕过', subtitle: '一键注入跨域响应头', icon: <GlobalOutlined />, component: CorsTool },
      { id: 'netrecord', title: '接口录制', subtitle: '保存当前 Tab 请求与响应', icon: <DatabaseOutlined />, component: NetRecordTool, wide: true },
      { id: 'framestore', title: '框架状态', subtitle: 'Pinia / Vuex / Redux 探测编辑', icon: <ClusterOutlined />, component: FrameStoreTool, wide: true },
    ],
  },
];

/** 全部工具平铺（供按 id 查找） */
export const ALL_TOOLS: ToolMeta[] = TOOL_GROUPS.flatMap((g) => g.tools);
