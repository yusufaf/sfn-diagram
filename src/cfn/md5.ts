/** Per-round left-rotation amounts (RFC 1321 section 3.4). */
const SHIFTS: readonly number[] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/**
 * The RFC 1321 `T[i]` constants, written out rather than derived from `Math.sin`, whose
 * precision is engine-defined: every runtime must produce the same digest.
 */
const CONSTANTS: readonly number[] = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

/**
 * Parameters for {@link md5Hex}.
 */
export interface Md5HexParams {
    /** Text to hash; its UTF-8 bytes are digested. */
    text: string;
}

/**
 * Computes the MD5 digest of a string's UTF-8 bytes as 32 lowercase hex characters.
 *
 * It exists only to reproduce the hash suffix CDK puts on logical IDs, and is written from
 * RFC 1321 so `sfn-diagram/cfn` runs without `node:crypto` (browsers, workers, edge). Not for
 * security use.
 *
 * @param params - The text to hash.
 * @returns The digest, for example `900150983cd24fb0d6963f7d28e17f72` for `abc`.
 *
 * @example
 * ```typescript
 * md5Hex({ text: 'OrderWorkflow/Resource' }).slice(0, 8).toUpperCase(); // '0015CDD9'
 * ```
 */
export function md5Hex(params: Md5HexParams): string {
    const bytes = new TextEncoder().encode(params.text);
    // Message, a 0x80 byte, zero padding to 56 mod 64, then the bit length as 64-bit little endian.
    const blockCount = Math.ceil((bytes.length + 9) / 64);
    const padded = new Uint8Array(blockCount * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const bitLength = bytes.length * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, bitLength >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);

    let stateA = 0x67452301;
    let stateB = 0xefcdab89;
    let stateC = 0x98badcfe;
    let stateD = 0x10325476;
    const words = new Array<number>(16);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let index = 0; index < 16; index++) {
            words[index] = view.getUint32(offset + index * 4, true);
        }
        let wordA = stateA;
        let wordB = stateB;
        let wordC = stateC;
        let wordD = stateD;
        for (let step = 0; step < 64; step++) {
            let mixed: number;
            let wordIndex: number;
            if (step < 16) {
                mixed = (wordB & wordC) | (~wordB & wordD);
                wordIndex = step;
            } else if (step < 32) {
                mixed = (wordD & wordB) | (~wordD & wordC);
                wordIndex = (5 * step + 1) % 16;
            } else if (step < 48) {
                mixed = wordB ^ wordC ^ wordD;
                wordIndex = (3 * step + 5) % 16;
            } else {
                mixed = wordC ^ (wordB | ~wordD);
                wordIndex = (7 * step) % 16;
            }
            const sum = (wordA + mixed + CONSTANTS[step] + words[wordIndex]) | 0;
            const shift = SHIFTS[step];
            wordA = wordD;
            wordD = wordC;
            wordC = wordB;
            wordB = (wordB + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
        }
        stateA = (stateA + wordA) | 0;
        stateB = (stateB + wordB) | 0;
        stateC = (stateC + wordC) | 0;
        stateD = (stateD + wordD) | 0;
    }

    const digest = new DataView(new ArrayBuffer(16));
    digest.setUint32(0, stateA, true);
    digest.setUint32(4, stateB, true);
    digest.setUint32(8, stateC, true);
    digest.setUint32(12, stateD, true);
    let hex = '';
    for (let index = 0; index < 16; index++) {
        hex += digest.getUint8(index).toString(16).padStart(2, '0');
    }
    return hex;
}
