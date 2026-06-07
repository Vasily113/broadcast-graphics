export interface RundownSlot {
  slotId: string;
  templateId: string;
  name: string;
  vars: Record<string, string>;
}

export interface RundownData {
  id: string;
  name: string;
  slots: RundownSlot[];
  channelId: string | null;
  created_at: number;
  updated_at: number;
}
