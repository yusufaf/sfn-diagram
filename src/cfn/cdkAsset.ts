import { stripBom } from '../utils/bom';

const TEMPLATE_SUFFIX = '.template.json';
const NESTED_SUFFIX = '.nested.template.json';

/** An optional bucket prefix, the asset's sha256 source hash, then the file's extension. */
const CDK_ASSET_KEY = /[0-9a-f]{64}(?:\.[^./]*)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parameters for {@link assetManifestName}. */
export interface AssetManifestNameParams {
    /** The template's file name or path. */
    templateFileName: string;
}

/**
 * Names the asset manifest `cdk synth` writes beside a stack template.
 *
 * @param params - The template's file name or path.
 * @returns `Stack.assets.json` for `…/Stack.template.json`, or `undefined` for any other
 * name, nested stack templates included.
 */
export function assetManifestName(params: AssetManifestNameParams): string | undefined {
    const name = params.templateFileName.split(/[\\/]/).pop() ?? '';
    if (
        !name.endsWith(TEMPLATE_SUFFIX) ||
        name.length === TEMPLATE_SUFFIX.length ||
        name.endsWith(NESTED_SUFFIX)
    ) {
        return undefined;
    }
    return `${name.slice(0, -TEMPLATE_SUFFIX.length)}.assets.json`;
}

/** Parameters for {@link isCdkAssetKey}. */
export interface IsCdkAssetKeyParams {
    /** The template's `DefinitionS3Location.Key`. */
    objectKey: string;
}

/**
 * Tells whether an S3 object key has the shape CDK gives a file asset.
 *
 * @param params - The object key.
 * @returns Whether it ends in a lowercase sha256 hex hash plus an optional extension.
 */
export function isCdkAssetKey(params: IsCdkAssetKeyParams): boolean {
    return CDK_ASSET_KEY.test(params.objectKey);
}

/** Parameters for {@link findCdkAssetPath}. */
export interface FindCdkAssetPathParams {
    /** The asset manifest's text. */
    manifest: string;
    /** The template's `DefinitionS3Location.Key`. */
    objectKey: string;
}

/**
 * Finds the staged file of the asset a CDK manifest publishes to an object key.
 *
 * @param params - The manifest's text and the object key.
 * @returns The asset's `source.path`, relative to the manifest, or `undefined` when the
 * manifest is not JSON or lists no single-file asset published to that key.
 */
export function findCdkAssetPath(params: FindCdkAssetPathParams): string | undefined {
    const { objectKey } = params;
    let parsed: unknown;
    try {
        parsed = JSON.parse(stripBom(params.manifest));
    } catch {
        return undefined;
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.files)) {
        return undefined;
    }
    for (const asset of Object.values(parsed.files)) {
        if (!isPlainObject(asset) || !isPlainObject(asset.source) || !isPlainObject(asset.destinations)) {
            continue;
        }
        const { packaging, path } = asset.source;
        if (typeof path !== 'string' || (packaging !== undefined && packaging !== 'file')) {
            continue;
        }
        const published = Object.values(asset.destinations).some(
            (destination) => isPlainObject(destination) && destination.objectKey === objectKey,
        );
        if (published) {
            return path;
        }
    }
    return undefined;
}
