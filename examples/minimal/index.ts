import { createChronicle, defineEvent, t } from '@ubercode/chronicler';

// 1. Define a typed event
const userSignup = defineEvent({
  key: 'user.signup',
  level: 'info',
  message: 'New user signed up',
  doc: 'Fired after a user completes registration',
  fields: {
    userId: t.string().doc('Unique user ID'),
    plan: t.string().optional().doc('Subscription plan'),
  },
});

// 2. Create a chronicle (defaults to console backend)
const chronicle = createChronicle({ metadata: { service: 'signup-api' } });

// 3. Log a typed event — TypeScript enforces the field shape
chronicle.event(userSignup, { userId: 'u_42', plan: 'pro' });

// 4. Quick untyped log — no event definition needed
chronicle.log('debug', 'Health check passed', { uptime: process.uptime() });
