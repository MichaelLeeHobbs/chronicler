import { createChronicle, defineEvents, event, field } from '@ubercode/chronicler';

// 1. Define a typed event catalog. The key `user.signup` comes from the path.
const events = defineEvents({
  user: {
    signup: event({
      level: 'info',
      message: 'New user signed up',
      doc: 'Fired after a user completes registration',
      fields: {
        userId: field.string().doc('Unique user ID'),
        plan: field.string().optional().doc('Subscription plan'),
      },
    }),
  },
});

// 2. Create a chronicle (defaults to console backend)
const chronicle = createChronicle({ events, metadata: { service: 'signup-api' } });
const { user } = chronicle;

// 3. Log a typed event — TypeScript enforces the field shape
user.signup({ userId: 'u_42', plan: 'pro' });

// 4. Quick untyped log — no event definition needed
chronicle.log('debug', 'Health check passed', { uptime: process.uptime() });
