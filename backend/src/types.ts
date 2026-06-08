import type { Channel, ChannelSettings, Rundown, Template } from '@broadcast-graphics/shared';

export interface TemplateRow {
  id: string;
  name: string;
  data: Template;
  created_at: number;
  updated_at: number;
}

export interface DatabaseData {
  templates: TemplateRow[];
  rundowns: Rundown[];
  settings: ChannelSettings;
  channels: Channel[];
}
