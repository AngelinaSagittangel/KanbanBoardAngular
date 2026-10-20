const getLocalDateKey = (date: Date): number => {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
};

const parseDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
};

export const formatDueDate = (value: string): string => {
  const date = parseDate(value);

  if (!date) {
    return value;
  }

  const today = new Date();
  const difference = getLocalDateKey(date) - getLocalDateKey(today);

  if (difference === 0) {
    return 'Сегодня';
  }

  if (difference === 1) {
    return 'Завтра';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(date);
};

export const isDueDateOverdue = (value: string): boolean => {
  const date = parseDate(value);

  if (!date) {
    return false;
  }

  return getLocalDateKey(date) < getLocalDateKey(new Date());
};
