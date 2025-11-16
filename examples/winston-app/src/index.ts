import * as winston from 'winston';
import { createChronicle } from 'chronicler';
import { request, system } from './events';

// Configure Winston
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

// Create backend adapter that maps Chronicler levels to Winston methods
const winstonBackend = {
  fatal: (msg: string, data: unknown) => logger.error(msg, data),
  critical: (msg: string, data: unknown) => logger.error(msg, data),
  alert: (msg: string, data: unknown) => logger.error(msg, data),
  error: (msg: string, data: unknown) => logger.error(msg, data),
  warn: (msg: string, data: unknown) => logger.warn(msg, data),
  audit: (msg: string, data: unknown) => logger.info(msg, data),
  info: (msg: string, data: unknown) => logger.info(msg, data),
  debug: (msg: string, data: unknown) => logger.debug(msg, data),
  trace: (msg: string, data: unknown) => logger.silly(msg, data),
};

// Create chronicle
const chronicle = createChronicle({
  backend: winstonBackend,
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
