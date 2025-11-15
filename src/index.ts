export type ChronicleEntry = {
  timestamp: Date;
  message: string;
  data?: Record<string, unknown>;
};

export const createEntry = (message: string, data?: Record<string, unknown>): ChronicleEntry => ({
  timestamp: new Date(),
  message,
  data,
});

export const formatEntry = (entry: ChronicleEntry): string => {
  const base = `[${entry.timestamp.toISOString()}] ${entry.message}`;
  if (!entry.data) {
    return base;
  }

  return `${base} ${JSON.stringify(entry.data)}`;
};
