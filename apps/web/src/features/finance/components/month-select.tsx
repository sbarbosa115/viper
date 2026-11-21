import type { Month } from '@app/contracts/finance';
import { t } from '../../../shared/i18n';
import { Select } from '../../../shared/ui';
import { monthLabel, monthRange } from '../lib/format';

export interface MonthSelectProps {
  month: Month;
  current: Month;
  onChange: (month: Month) => void;
}

/** November 2026 to the current month, newest first; the current month says "(to date)". */
export function MonthSelect({ month, current, onChange }: MonthSelectProps) {
  const options = [...monthRange(current)].reverse();
  return (
    <label className="flex items-center gap-2 text-[13px] text-muted">
      {t('finance.month')}
      <Select
        value={month}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-auto min-w-44 md:h-10"
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {m === current
              ? t('finance.monthOption.toDate', { month: monthLabel(m) })
              : monthLabel(m)}
          </option>
        ))}
      </Select>
    </label>
  );
}
