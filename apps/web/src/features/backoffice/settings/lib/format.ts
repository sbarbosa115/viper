const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export const formatDay = (iso: string): string => day.format(new Date(iso));
