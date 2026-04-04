export interface ArchiveMonthOption {
  month: string;
  job_count: number;
}

export const getCurrentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export const formatMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) {
    return monthKey;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
};

export const mergeArchiveMonths = (
  months: ArchiveMonthOption[] | undefined,
  currentMonth: string,
) => {
  const monthMap = new Map<string, ArchiveMonthOption>();

  monthMap.set(currentMonth, {
    month: currentMonth,
    job_count: 0,
  });

  for (const month of months ?? []) {
    monthMap.set(month.month, month);
  }

  return Array.from(monthMap.values()).sort((a, b) => b.month.localeCompare(a.month));
};
