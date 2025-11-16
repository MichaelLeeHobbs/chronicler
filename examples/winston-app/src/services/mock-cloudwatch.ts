/**
 * Mock CloudWatch Transport for Winston
 * In a real app, you would use 'winston-aws-cloudwatch' or similar
 */

import Transport from 'winston-transport';

interface CloudWatchTransportOptions extends Transport.TransportStreamOptions {
  logGroupName?: string;
  logStreamName?: string;
  region?: string;
  uploadRate?: number;
  errorHandler?: (err: Error) => void;
}

/**
 * Mock CloudWatch Transport for demonstration purposes
 * In production, use actual winston-aws-cloudwatch package
 */
export class MockCloudWatchTransport extends Transport {
  private logGroupName: string;
  private logStreamName: string;
  private region: string;
  private buffer: any[] = [];

  constructor(opts: CloudWatchTransportOptions) {
    super(opts);
    this.logGroupName = opts.logGroupName || '/aws/nodejs/app';
    this.logStreamName = opts.logStreamName || 'default';
    this.region = opts.region || 'us-east-1';

    // Simulate periodic upload (in real implementation, this would send to AWS)
    if (opts.uploadRate) {
      setInterval(() => this.flush(), opts.uploadRate);
    }
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      // In real implementation, this would buffer and send to CloudWatch
      this.buffer.push({
        timestamp: new Date().toISOString(),
        message: info.message,
        level: info.level,
        ...info,
      });

      // Simulate CloudWatch log line format
      if (process.env.DEBUG_CW) {
        console.log(`[MockCW:${this.logGroupName}:${this.logStreamName}]`, JSON.stringify(info));
      }
    });

    callback();
  }

  private flush() {
    // In real implementation, send buffer to CloudWatch
    if (this.buffer.length > 0 && process.env.DEBUG_CW) {
      console.log(`[MockCW] Would upload ${this.buffer.length} logs to CloudWatch`);
      this.buffer = [];
    }
  }
}
