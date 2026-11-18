import { describe, expect, test } from 'bun:test';
import { networkOf } from './ipv6';

describe('networkOf', () => {
	test('IPv4 is unchanged', () => {
		expect(networkOf('203.0.113.9', 64)).toBe('203.0.113.9');
	});
	test('a /64 keeps the first four groups', () => {
		expect(networkOf('2001:db8:1:2:3:4:5:6', 64)).toBe(
			'2001:db8:1:2:0:0:0:0/64',
		);
	});
	test('compression expands', () => {
		expect(networkOf('2001:db8::1', 32)).toBe('2001:db8:0:0:0:0:0:0/32');
		expect(networkOf('::1', 128)).toBe('0:0:0:0:0:0:0:1/128');
	});
	test('two addresses of one network match', () => {
		expect(networkOf('2001:db8:0:1::a', 64)).toBe(
			networkOf('2001:DB8:0:1:ffff::b', 64),
		);
	});
	test('a zone is dropped', () => {
		expect(networkOf('fe80::1%en0', 64)).toBe('fe80:0:0:0:0:0:0:0/64');
	});
	test('an IPv4-mapped address becomes plain IPv4, in both spellings', () => {
		expect(networkOf('::ffff:192.0.2.1', 64)).toBe('192.0.2.1');
		expect(networkOf('::ffff:c000:201', 64)).toBe('192.0.2.1');
		expect(networkOf('::FFFF:c000:0201', 0)).toBe('192.0.2.1');
	});
	test('a dotted tail on another prefix stays IPv6', () => {
		expect(networkOf('64:ff9b::192.0.2.33', 128)).toBe(
			'64:ff9b:0:0:0:0:c000:221/128',
		);
	});
	test('prefix 0 and 128, and a prefix off a group boundary', () => {
		expect(networkOf('2001:db8::1', 0)).toBe('0:0:0:0:0:0:0:0/0');
		expect(networkOf('2001:db8::1', 128)).toBe('2001:db8:0:0:0:0:0:1/128');
		expect(networkOf('2001:db8:ffff::', 36)).toBe('2001:db8:f000:0:0:0:0:0/36');
	});
	test('garbage is returned as is', () => {
		expect(networkOf('not:an:address', 64)).toBe('not:an:address');
	});
});
