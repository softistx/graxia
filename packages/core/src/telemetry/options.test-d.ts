import { createTelemetry } from '@softistx/telemetry';
import type { TelemetryOptions } from './options';

// A Telemetry from createTelemetry is accepted; anything else is rejected at compile time.
const accepted: TelemetryOptions = { instance: createTelemetry('x') };
// @ts-expect-error an empty object is not a Telemetry
const rejected: TelemetryOptions = { instance: {} };
void accepted;
void rejected;

// operationSpans is a boolean.
const spans: TelemetryOptions = { operationSpans: false };
// @ts-expect-error a string is not a boolean
const wrongSpans: TelemetryOptions = { operationSpans: 'no' };
void spans;
void wrongSpans;
