import { inflateSync } from 'node:zlib';

const PNG_BYTES_PER_PIXEL = 4;

/** The eight bytes every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A decoded PNG: its dimensions and raw, unfiltered RGBA8 pixel data. */
export interface DecodedPng {
    height: number;
    pixels: Buffer;
    width: number;
}

/**
 * Decode a non-interlaced 8-bit RGBA PNG to raw pixels.
 *
 * Deliberately minimal, and deliberately dependency-free: it exists so a test
 * can assert something about the *pixels* resvg produced rather than only that
 * a PNG came out at all (#336 — a font misconfiguration still yields a
 * perfectly valid, entirely blank PNG). resvg always emits this one format, so
 * anything else is a sign the engine changed and throws rather than guessing.
 *
 * @param png - PNG file contents.
 * @returns The image dimensions and its RGBA pixel data, 4 bytes per pixel.
 * @throws if the buffer is not a PNG, or not 8-bit RGBA and non-interlaced.
 *
 * @example
 * ```typescript
 * const { pixels } = decodePng(buffer);
 * const painted = countOpaquePixels(decodePng(buffer));
 * ```
 */
export function decodePng(png: Buffer): DecodedPng {
    // Length first: readUInt32BE on a 3-byte buffer throws a RangeError, which
    // is not the error this is supposed to report.
    if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error('decodePng: not a PNG (bad signature)');
    }

    let offset = 8;
    let height = 0;
    let width = 0;
    const idat: Buffer[] = [];

    // A chunk header is 4 length bytes + 4 type bytes; a buffer that ends mid
    // header would make readUInt32BE throw a RangeError, which says nothing
    // about the input - the same reason the signature is length-checked above.
    while (offset + 8 <= png.length) {
        const length = png.readUInt32BE(offset);
        const type = png.toString('ascii', offset + 4, offset + 8);
        // subarray clamps silently, so a chunk claiming more than is there would
        // reach the IHDR field reads below and throw a bare RangeError.
        if (offset + 8 + length > png.length) {
            throw new Error(`decodePng: ${type} chunk claims ${length} bytes, past the end`);
        }

        const data = png.subarray(offset + 8, offset + 8 + length);

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            const bitDepth = data[8];
            const colorType = data[9];
            const interlace = data[12];
            if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
                throw new Error(
                    `decodePng: expected 8-bit RGBA, non-interlaced; got bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`
                );
            }
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }

        // length + type + data + CRC32
        offset += 12 + length;
    }

    if (width === 0 || height === 0) {
        throw new Error('decodePng: no IHDR chunk, or zero dimensions');
    }

    return { height, pixels: unfilter({ height, raw: inflateSync(Buffer.concat(idat)), width }), width };
}

/** Parameters for {@link unfilter}. */
interface UnfilterParams {
    height: number;
    raw: Buffer;
    width: number;
}

/**
 * Reverse PNG's per-scanline byte filters (RFC 2083 section 6).
 *
 * Each inflated scanline is prefixed with a filter byte and is predicted from
 * the byte to its left (`a`), the byte above (`b`), and the byte above-left
 * (`c`), so it has to be undone top-to-bottom against already-reconstructed
 * output.
 *
 * @param params - The inflated scanlines and the image dimensions.
 * @returns Unfiltered RGBA8 pixel data, `width * height * 4` bytes.
 * @throws if a scanline declares an unknown filter type.
 */
function unfilter(params: UnfilterParams): Buffer {
    const { height, raw, width } = params;
    const stride = width * PNG_BYTES_PER_PIXEL;

    // Without this, a short scanline reads as `undefined`, every arithmetic step
    // after it is NaN, `NaN & 0xff` is 0, and the decoder quietly returns a
    // fully transparent image - which is the one result the tests here read as
    // meaningful.
    const expected = height * (stride + 1);
    if (raw.length !== expected) {
        throw new Error(`decodePng: inflated ${raw.length} bytes, expected ${expected}`);
    }

    const pixels = Buffer.alloc(height * stride);

    for (let row = 0; row < height; row++) {
        const rowStart = row * (stride + 1);
        const filter = raw[rowStart];
        const out = row * stride;

        for (let index = 0; index < stride; index++) {
            const left = index >= PNG_BYTES_PER_PIXEL ? pixels[out + index - PNG_BYTES_PER_PIXEL] : 0;
            const above = row > 0 ? pixels[out - stride + index] : 0;
            const aboveLeft =
                row > 0 && index >= PNG_BYTES_PER_PIXEL
                    ? pixels[out - stride + index - PNG_BYTES_PER_PIXEL]
                    : 0;
            const value = raw[rowStart + 1 + index];

            pixels[out + index] = (value + predict({ above, aboveLeft, filter, left })) & 0xff;
        }
    }

    return pixels;
}

/** Parameters for {@link predict}. */
interface PredictParams {
    above: number;
    aboveLeft: number;
    filter: number;
    left: number;
}

/**
 * The predicted byte value a PNG filter type subtracted when encoding.
 *
 * @param params - The filter type and the three neighbouring reconstructed bytes.
 * @returns The value to add back to the filtered byte.
 * @throws if the filter type is not one of the five PNG defines.
 */
function predict(params: PredictParams): number {
    const { above, aboveLeft, filter, left } = params;

    switch (filter) {
        case 0:
            return 0;
        case 1:
            return left;
        case 2:
            return above;
        case 3:
            return (left + above) >> 1;
        case 4: {
            const estimate = left + above - aboveLeft;
            const distances = [
                { byte: left, distance: Math.abs(estimate - left) },
                { byte: above, distance: Math.abs(estimate - above) },
                { byte: aboveLeft, distance: Math.abs(estimate - aboveLeft) },
            ];
            // Ties go to the earliest of left, above, aboveLeft - the spec's order.
            return distances.reduce((best, candidate) =>
                candidate.distance < best.distance ? candidate : best
            ).byte;
        }
        default:
            throw new Error(`decodePng: unknown scanline filter type ${filter}`);
    }
}

/**
 * Count pixels that were actually painted, i.e. are not fully transparent.
 *
 * @param decoded - A {@link decodePng} result.
 * @returns How many of its pixels have a non-zero alpha channel.
 */
export function countOpaquePixels(decoded: DecodedPng): number {
    let count = 0;
    for (let alpha = 3; alpha < decoded.pixels.length; alpha += PNG_BYTES_PER_PIXEL) {
        if (decoded.pixels[alpha] > 0) {
            count++;
        }
    }
    return count;
}
