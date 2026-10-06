import { describe, it, expect } from 'vitest';
import { assertNoRemoteTracing, RemoteTracingError } from './guards';

describe('assertNoRemoteTracing', () => {
  it('passes when no tracing variables are set', () => {
    expect(() => assertNoRemoteTracing({ PATH: '/usr/bin' })).not.toThrow();
  });

  it.each([
    ['LANGSMITH_TRACING', 'true'],
    ['LANGCHAIN_TRACING_V2', 'true'],
    ['LANGCHAIN_TRACING', 'true'],
    ['LANGSMITH_API_KEY', 'lsv2_abc'],
    ['LANGCHAIN_API_KEY', 'lsv2_abc'],
  ])('refuses to start when %s is set', (name, value) => {
    expect(() => assertNoRemoteTracing({ [name]: value })).toThrow(RemoteTracingError);
    expect(() => assertNoRemoteTracing({ [name]: value })).toThrow(name);
  });

  it.each(['false', '0', ''])('treats LANGSMITH_TRACING=%j as off', (value) => {
    expect(() => assertNoRemoteTracing({ LANGSMITH_TRACING: value })).not.toThrow();
  });
});
