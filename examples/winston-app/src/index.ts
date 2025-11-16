import * as winston from 'winston';
import { createChronicle } from 'chronicler';
import { request, system } from './events';

// Map Chronicler levels to Winston levels
const levelMap: Record<string, string> = {
  fatal: 'error',
  critical: 'error',
  alert: 'error',
  error: 'error',
  warn: 'warn',
  audit: 'info',
  info: 'info',
  debug: 'debug',
  trace: 'silly',
};

class WinstonBackend {
  constructor(private logger: winston.Logger) {}
  supportsLevel(): boolean {
    return true;
  }
  log(level: string, message: string, payload: any): void {
    this.logger.log({ level: levelMap[level] ?? 'info', message, payload });
  }
}

// Configure Winston
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

// Create chronicle
const chronicle = createChronicle({
  backend: new WinstonBackend(logger) as any,
  metadata: { service: 'winston-app', env: process.env.NODE_ENV ?? 'dev' },
  monitoring: { memory: true },
});

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  chronicle.event(system.events.startup, { port });

  const corr = chronicle.startCorrelation(request, { requestId: 'req-123' });
  corr.event(request.events.validated, { method: 'GET', path: '/' });

  const fork = corr.fork({ step: 'background-task' });
  fork.event(system.events.startup, { port: 0 });

  await new Promise((r) => setTimeout(r, 100));
  corr.complete();
}

main().catch((err) => {
  logger.error('Example failed', { err });
  process.exit(1);
});
