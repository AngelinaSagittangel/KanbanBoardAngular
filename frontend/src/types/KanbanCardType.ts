
export type ChecklistItemType = {
  id: string;
  text: string;
  completed: boolean;
};

export type CardAssigneeType = {
  id: string;
  name: string;
};

export type KanbanCardType = {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  updatedAt: string;
  dueDate?: string;
  label?: string | null;
  labelColor?: 'purple' | 'blue' | 'green' | null;
  checklist?: ChecklistItemType[] | null;
  assigneeId?: string | null;
  assignee?: CardAssigneeType | null;
};
