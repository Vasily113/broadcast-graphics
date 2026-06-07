import type { Template } from '../../core/schema';

export interface TemplateItem {
  id: string;
  name: string;
  created_at?: number;
  updated_at: number;
}

export interface FullTemplate extends TemplateItem {
  data: Template;
}
