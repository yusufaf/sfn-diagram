import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { md5Hex } from '../../src/cfn/md5';

const nodeMd5 = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex');

describe('md5Hex', () => {
    it.each([
        ['', 'd41d8cd98f00b204e9800998ecf8427e'],
        ['a', '0cc175b9c0f1b6a831c399e269772661'],
        ['abc', '900150983cd24fb0d6963f7d28e17f72'],
        ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
        ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
        [
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
            'd174ab98d277d9f5a5611c2c9f419d9f',
        ],
        ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
    ])('matches the RFC 1321 test vector for %j', (text, expected) => {
        expect(md5Hex({ text })).toBe(expected);
    });

    it('matches node:crypto for every length across the padding boundaries', () => {
        for (let length = 0; length <= 130; length++) {
            const text = 'x'.repeat(length);
            expect(md5Hex({ text }), `length ${length}`).toBe(nodeMd5(text));
        }
    });

    it('hashes the UTF-8 bytes of a multi-byte string', () => {
        const text = 'Ünïcode/状态机/🚀';
        expect(md5Hex({ text })).toBe(nodeMd5(text));
    });
});
