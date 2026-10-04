import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { countOpaquePixels, decodePng } from './decodePng';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Build a PNG with the given chunks, CRCs left as zero (the decoder ignores them). */
const png = (chunks: { data: Buffer; type: string }[]): Buffer =>
    Buffer.concat([
        PNG_SIGNATURE,
        ...chunks.flatMap(({ data, type }) => {
            const length = Buffer.alloc(4);
            length.writeUInt32BE(data.length);
            return [length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)];
        }),
    ]);

/** An IHDR for an 8-bit RGBA, non-interlaced image. */
const ihdr = (width: number, height: number): Buffer => {
    const data = Buffer.alloc(13);
    data.writeUInt32BE(width, 0);
    data.writeUInt32BE(height, 4);
    data[8] = 8;
    data[9] = 6;
    return data;
};

/**
 * These exist because the decoder's whole job in `tests/resvgEngine.test.ts` is
 * to make "zero painted pixels" a meaningful assertion. Every way it could
 * return a blank image instead of failing has to be an error.
 */
describe('decodePng', () => {
    it('rejects a buffer that is not a PNG', () => {
        expect(() => decodePng(Buffer.alloc(32))).toThrow(/not a PNG/);
    });

    // readUInt32BE on a 3-byte buffer throws a RangeError, which says nothing
    // about what was wrong with the input.
    it.each([0, 3, 7])('rejects a %i-byte buffer with the signature error', (length) => {
        expect(() => decodePng(Buffer.alloc(length))).toThrow(/not a PNG/);
    });

    it('rejects a buffer whose signature matches only in its first four bytes', () => {
        const almost = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);

        expect(() => decodePng(almost)).toThrow(/not a PNG/);
    });

    it.each([8, 9, 11])('rejects a %i-byte buffer, which ends mid chunk header', (length) => {
        const truncated = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(length - 8)]);

        expect(() => decodePng(truncated)).toThrow(/no IHDR/);
    });

    it('rejects a chunk claiming more bytes than the buffer holds', () => {
        const header = Buffer.alloc(8);
        header.writeUInt32BE(64, 0);
        header.write('IHDR', 4, 'ascii');

        expect(() => decodePng(Buffer.concat([PNG_SIGNATURE, header, Buffer.alloc(4)]))).toThrow(
            /IHDR chunk claims 64 bytes/
        );
    });

    it('rejects a PNG with no IHDR', () => {
        expect(() => decodePng(png([{ data: deflateSync(Buffer.alloc(0)), type: 'IDAT' }]))).toThrow(
            /no IHDR/
        );
    });

    it('rejects a format it cannot decode, rather than misreading it', () => {
        const paletted = ihdr(2, 2);
        paletted[9] = 3;

        expect(() =>
            decodePng(png([{ data: paletted, type: 'IHDR' }, { data: deflateSync(Buffer.alloc(0)), type: 'IDAT' }]))
        ).toThrow(/expected 8-bit RGBA/);
    });

    it('rejects truncated pixel data instead of returning a blank image', () => {
        const short = png([
            { data: ihdr(2, 2), type: 'IHDR' },
            // One scanline short of the 2 * (2 * 4 + 1) bytes this image needs.
            { data: deflateSync(Buffer.alloc(9)), type: 'IDAT' },
        ]);

        expect(() => decodePng(short)).toThrow(/inflated 9 bytes, expected 18/);
    });

    it('decodes a filter-0 image and counts only its opaque pixels', () => {
        const opaqueRed = [0xff, 0x00, 0x00, 0xff];
        const transparent = [0x00, 0x00, 0x00, 0x00];
        const scanline = Buffer.from([0, ...opaqueRed, ...transparent]);
        const image = png([
            { data: ihdr(2, 2), type: 'IHDR' },
            { data: deflateSync(Buffer.concat([scanline, scanline])), type: 'IDAT' },
        ]);

        const decoded = decodePng(image);

        expect([decoded.width, decoded.height]).toEqual([2, 2]);
        expect(decoded.pixels.subarray(1, 4)).toEqual(Buffer.from([0x00, 0x00, 0xff]));
        expect(countOpaquePixels(decoded)).toBe(2);
    });
});
