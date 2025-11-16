/**
 * Application configuration
 */

export const config = {
  // Environment
  environment: (process.env.NODE_ENV || 'development') as 'development' | 'production',

  // Server
  port: parseInt(process.env.PORT || '3000', 10),

  // Logger
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // CloudWatch (for production)
  awsCloudWatch: {
    logGroupName: process.env.AWS_LOG_GROUP || '/aws/nodejs/chronicler-app',
    region: process.env.AWS_REGION || 'us-east-1',
    uploadRate: 2000, // Send logs every 2 seconds
    errorHandler: (err: Error) => {
      console.error('CloudWatch error:', err);
    },
  },

  // App metadata
  app: {
    name: 'winston-app',
    version: process.env.APP_VERSION || '1.0.0',
  },
} as const;

export default config;
